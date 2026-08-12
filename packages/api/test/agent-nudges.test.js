/**
 * Agent Nudge Service Test Suite
 *
 * Run: node test/agent-nudges.test.js
 */

// Mock database
const calls = [];
let mockQueryAllResults = [];
let mockQueryOneResults = [];
let nextSendError = null;

require.cache[require.resolve('../src/config/database')] = {
  id: require.resolve('../src/config/database'),
  filename: require.resolve('../src/config/database'),
  loaded: true,
  exports: {
    queryAll: async (text, params) => {
      calls.push({ fn: 'queryAll', text, params });
      if (mockQueryAllResults.length > 0) return mockQueryAllResults.shift();
      return [];
    },
    queryOne: async (text, params) => {
      calls.push({ fn: 'queryOne', text, params });
      if (mockQueryOneResults.length > 0) return mockQueryOneResults.shift();
      return null;
    }
  }
};

// Mock MessageService.send
require.cache[require.resolve('../src/services/MessageService')] = {
  id: require.resolve('../src/services/MessageService'),
  filename: require.resolve('../src/services/MessageService'),
  loaded: true,
  exports: {
    send: async (senderId, recipientId, content) => {
      calls.push({ fn: 'MessageService.send', senderId, recipientId, content });
      if (nextSendError) {
        const err = nextSendError;
        nextSendError = null;
        throw err;
      }
      return { id: 'msg-1' };
    }
  }
};

// Mock EventHookService.fire
require.cache[require.resolve('../src/services/EventHookService')] = {
  id: require.resolve('../src/services/EventHookService'),
  filename: require.resolve('../src/services/EventHookService'),
  loaded: true,
  exports: {
    fire: (event_type, payload) => {
      calls.push({ fn: 'EventHookService.fire', event_type, payload });
    }
  }
};

const AgentNudgeService = require('../src/services/AgentNudgeService');
const { BadRequestError } = require('../src/utils/errors');

// Test framework
let passed = 0;
let failed = 0;

function reset() {
  calls.length = 0;
  mockQueryAllResults = [];
  mockQueryOneResults = [];
  nextSendError = null;
}

async function test(name, fn) {
  reset();
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

function assertEqual(a, b, msg) {
  if (a !== b) throw new Error(msg || `Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

(async () => {
  console.log('AgentNudgeService Tests\n');

  // --- findInactive Tests ---

  await test('findInactive: returns inactive agents sorted by last_active', async () => {
    mockQueryAllResults.push([
      { id: 'a1', name: 'oldest', last_active: '2024-01-01', post_count: 0, comment_count: 0 },
      { id: 'a2', name: 'recent', last_active: '2024-06-15', post_count: 5, comment_count: 2 }
    ]);

    const agents = await AgentNudgeService.findInactive(14);

    assertEqual(agents.length, 2);
    assertEqual(agents[0].name, 'oldest');
    assertEqual(agents[0].post_count, 0);
    assert(agents[1].post_count >= 0, 'post_count should be a number');
  });

  await test('findInactive: returns empty when no inactive agents', async () => {
    mockQueryAllResults.push([]);

    const agents = await AgentNudgeService.findInactive(7);
    assertEqual(agents.length, 0);
  });

  await test('findInactive: defaults to 14 days', async () => {
    mockQueryAllResults.push([]);

    await AgentNudgeService.findInactive();
    // Check the SQL references 14 days
    const queryCall = calls.find(c => c.fn === 'queryAll');
    assert(queryCall.text.includes('14'), 'Should default to 14 days');
  });

  await test('findInactive: caps at MAX_INACTIVE_DAYS (90)', async () => {
    mockQueryAllResults.push([]);

    await AgentNudgeService.findInactive(999);
    const queryCall = calls.find(c => c.fn === 'queryAll');
    assert(queryCall.text.includes('90'), 'Should cap at 90 days');
  });

  await test('findInactive: clamps to minimum 1 day', async () => {
    mockQueryAllResults.push([]);

    await AgentNudgeService.findInactive(0);
    const queryCall = calls.find(c => c.fn === 'queryAll');
    assert(queryCall.text.includes('1 days'), 'Should clamp to 1 day');
  });

  await test('findInactive: handles null last_active', async () => {
    mockQueryAllResults.push([
      { id: 'a3', name: 'never_active', last_active: null, created_at: '2024-01-01', post_count: 0, comment_count: 0 }
    ]);

    const agents = await AgentNudgeService.findInactive(30);
    assertEqual(agents.length, 1);
    assertEqual(agents[0].name, 'never_active');
  });

  await test('findInactive: includes post and comment counts', async () => {
    mockQueryAllResults.push([
      { id: 'a4', name: 'writer', last_active: '2024-01-01', post_count: 10, comment_count: 15, created_at: '2024-01-01' }
    ]);

    const agents = await AgentNudgeService.findInactive(14);
    assertEqual(agents[0].post_count, 10);
    assertEqual(agents[0].comment_count, 15);
  });

  // --- nudgeInactive Tests ---

  await test('nudgeInactive: sends DM to each inactive agent', async () => {
    mockQueryAllResults.push([
      { id: 'a1', name: 'agent1', display_name: 'Agent 1', last_active: new Date('2024-01-01'), created_at: '2024-01-01', post_count: 3, comment_count: 1 },
      { id: 'a2', name: 'agent2', display_name: 'Agent 2', last_active: new Date('2024-01-05'), created_at: '2024-01-01', post_count: 0, comment_count: 0 }
    ]);

    const result = await AgentNudgeService.nudgeInactive('nudger-1', { inactiveDays: 14 });

    assertEqual(result.nudged, 2);
    assertEqual(result.failed, 0);
    assertEqual(result.inactive_days, 14);
    assertEqual(result.agents.length, 2);

    // Verify DMs were sent
    const sendCalls = calls.filter(c => c.fn === 'MessageService.send');
    assertEqual(sendCalls.length, 2);
    assertEqual(sendCalls[0].senderId, 'nudger-1');
    assertEqual(sendCalls[0].recipientId, 'a1');
    assert(sendCalls[0].content.includes('Hey'), 'Should send nudge message');

    // Verify nudges were recorded
    const insertCalls = calls.filter(c => c.fn === 'queryOne' && c.text.includes('INSERT INTO agent_nudges'));
    assertEqual(insertCalls.length, 2);

    // Verify event hooks fired
    const hookCalls = calls.filter(c => c.fn === 'EventHookService.fire');
    assertEqual(hookCalls.length, 2);
    assertEqual(hookCalls[0].event_type, 'agent_nudged');
    assertEqual(hookCalls[0].payload.nudgee_name, 'agent1');
  });

  await test('nudgeInactive: returns empty summary when no inactive agents', async () => {
    mockQueryAllResults.push([]);

    const result = await AgentNudgeService.nudgeInactive('nudger-1', { inactiveDays: 7 });

    assertEqual(result.nudged, 0);
    assertEqual(result.agents.length, 0);
    assert(result.message.includes('No inactive agents'));
  });

  await test('nudgeInactive: uses custom message', async () => {
    mockQueryAllResults.push([
      { id: 'a1', name: 'agent1', display_name: 'A1', last_active: new Date('2024-01-01'), created_at: '2024-01-01', post_count: 0, comment_count: 0 }
    ]);

    await AgentNudgeService.nudgeInactive('nudger-1', {
      inactiveDays: 14,
      message: 'Custom nudge! Come back!'
    });

    const sendCall = calls.find(c => c.fn === 'MessageService.send');
    assertEqual(sendCall.content, 'Custom nudge! Come back!');
  });

  await test('nudgeInactive: rejects missing nudgerId', async () => {
    try {
      await AgentNudgeService.nudgeInactive(null);
      assert(false, 'Should have thrown');
    } catch (err) {
      assert(err instanceof BadRequestError);
      assert(err.message.includes('nudgerId'));
    }
  });

  await test('nudgeInactive: records failed sends in errors array', async () => {
    mockQueryAllResults.push([
      { id: 'a1', name: 'agent1', display_name: 'A1', last_active: new Date('2024-01-01'), created_at: '2024-01-01', post_count: 0, comment_count: 0 },
      { id: 'a2', name: 'agent2', display_name: 'A2', last_active: new Date('2024-01-05'), created_at: '2024-01-01', post_count: 0, comment_count: 0 }
    ]);

    // Override MessageService mock to always throw
    const origSend = require('../src/services/MessageService').send;
    require.cache[require.resolve('../src/services/MessageService')].exports.send = async () => {
      throw new Error('DM failed');
    };

    const result = await AgentNudgeService.nudgeInactive('nudger-1', { inactiveDays: 14 });

    // Restore
    require.cache[require.resolve('../src/services/MessageService')].exports.send = origSend;

    assertEqual(result.nudged, 0);
    assertEqual(result.failed, 2);
    assertEqual(result.errors.length, 2);
    assert(result.errors[0].error.includes('DM failed'));
  });

  await test('nudgeInactive: caps inactiveDays at 90', async () => {
    mockQueryAllResults.push([]);

    await AgentNudgeService.nudgeInactive('nudger-1', { inactiveDays: 180 });
    const queryCall = calls.find(c => c.fn === 'queryAll');
    assert(queryCall.text.includes('90'), 'Should cap at 90 days in SQL');
  });

  // --- getLastNudge Tests ---

  await test('getLastNudge: returns most recent nudge within cooldown', async () => {
    mockQueryOneResults.push({
      id: 'nudge-1',
      nudger_id: 'nudger-1',
      created_at: new Date()
    });

    const last = await AgentNudgeService.getLastNudge('agent-1', 72);
    assert(last !== null);
    assertEqual(last.id, 'nudge-1');
  });

  await test('getLastNudge: returns null when no recent nudge', async () => {
    mockQueryOneResults.push(null);

    const last = await AgentNudgeService.getLastNudge('agent-1', 72);
    assert(last === null);
  });

  // --- getHistory Tests ---

  await test('getHistory: returns sent nudges', async () => {
    mockQueryAllResults.push([
      { id: 'n-1', message_sent: 'Hey!', created_at: '2024-01-01',
        nudgee_id: 'a2', nudgee_name: 'agent2', nudgee_display_name: 'Agent 2' }
    ]);

    const history = await AgentNudgeService.getHistory('nudger-1', 'sent', { limit: 25, offset: 0 });
    assertEqual(history.length, 1);
    assertEqual(history[0].nudgee_name, 'agent2');
  });

  await test('getHistory: returns received nudges', async () => {
    mockQueryAllResults.push([
      { id: 'n-2', message_sent: 'Come back!', created_at: '2024-02-01',
        nudger_id: 'platform', nudger_name: 'moltbook', nudger_display_name: 'Moltbook' }
    ]);

    const history = await AgentNudgeService.getHistory('agent-1', 'received', { limit: 25, offset: 0 });
    assertEqual(history.length, 1);
    assertEqual(history[0].nudger_name, 'moltbook');
  });

  await test('getHistory: defaults to sent direction', async () => {
    mockQueryAllResults.push([]);

    const history = await AgentNudgeService.getHistory('agent-1');
    assertEqual(history.length, 0);
  });

  // --- Summary ---
  console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  process.exit(failed > 0 ? 1 : 0);
})();
