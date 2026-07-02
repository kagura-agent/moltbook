/**
 * Activity Feed Test Suite
 *
 * Run: node test/activity.test.js
 */

// Mock database before requiring service
const calls = [];
let mockQueryOneResults = [];
let mockQueryAllResults = [];

require.cache[require.resolve('../src/config/database')] = {
  id: require.resolve('../src/config/database'),
  filename: require.resolve('../src/config/database'),
  loaded: true,
  exports: {
    queryOne: async (text, params) => {
      calls.push({ fn: 'queryOne', text, params });
      if (mockQueryOneResults.length > 0) {
        const item = mockQueryOneResults.shift();
        return item;
      }
      return null;
    },
    queryAll: async (text, params) => {
      calls.push({ fn: 'queryAll', text, params });
      if (mockQueryAllResults.length > 0) return mockQueryAllResults.shift();
      return [];
    },
    transaction: async (fn) => {
      calls.push({ fn: 'transaction' });
      const mockClient = {
        query: async (text, params) => {
          calls.push({ fn: 'client.query', text, params });
        }
      };
      return fn(mockClient);
    }
  }
};

// Mock NotificationService
require.cache[require.resolve('../src/services/NotificationService')] = {
  id: require.resolve('../src/services/NotificationService'),
  filename: require.resolve('../src/services/NotificationService'),
  loaded: true,
  exports: {
    create: async () => ({ id: 'notif-1' })
  }
};

const AgentService = require('../src/services/AgentService');

// Test framework
let passed = 0;
let failed = 0;

function reset() {
  calls.length = 0;
  mockQueryOneResults = [];
  mockQueryAllResults = [];
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

function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(msg || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// Tests
(async () => {
  console.log('AgentService activity feed tests:\n');

  // --- getActivity: empty ---
  await test('getActivity: returns empty array for agent with no activity', async () => {
    mockQueryAllResults = [[]];

    const result = await AgentService.getActivity('agent-1', { limit: 25, offset: 0 });
    assertEqual(result.length, 0);
    // Should include all 5 sub-queries in the UNION ALL
    const queryCall = calls.find(c => c.fn === 'queryAll');
    assert(queryCall, 'should call queryAll');
    assert(queryCall.text.includes('UNION ALL'), 'should use UNION ALL');
    assert(queryCall.text.includes("'post'"), 'should include post sub-query');
    assert(queryCall.text.includes("'comment'"), 'should include comment sub-query');
    assert(queryCall.text.includes("'reaction'"), 'should include reaction sub-query');
    assert(queryCall.text.includes("'comment_reaction'"), 'should include comment_reaction sub-query');
    assert(queryCall.text.includes("'follow'"), 'should include follow sub-query');
  });

  // --- getActivity: returns posts ---
  await test('getActivity: returns posts in activity feed', async () => {
    const mockActivity = [
      {
        type: 'post',
        created_at: '2026-07-02T10:00:00Z',
        target_id: 'post-1',
        post_title: 'My First Post',
        submolt: 'general',
        post_id: null,
        content: null,
        reaction_type: null,
        target_agent_name: null,
        target_agent_display_name: null
      }
    ];
    mockQueryAllResults = [mockActivity];

    const result = await AgentService.getActivity('agent-1');
    assertEqual(result.length, 1);
    assertEqual(result[0].type, 'post');
    assertEqual(result[0].post_title, 'My First Post');
    assertEqual(result[0].submolt, 'general');
    assertEqual(result[0].target_id, 'post-1');
  });

  // --- getActivity: returns comments with post context ---
  await test('getActivity: returns comments with post context', async () => {
    const mockActivity = [
      {
        type: 'comment',
        created_at: '2026-07-02T09:00:00Z',
        target_id: 'comment-1',
        post_title: 'Original Post Title',
        submolt: 'tech',
        post_id: 'post-99',
        content: 'Great post!',
        reaction_type: null,
        target_agent_name: null,
        target_agent_display_name: null
      }
    ];
    mockQueryAllResults = [mockActivity];

    const result = await AgentService.getActivity('agent-1');
    assertEqual(result.length, 1);
    assertEqual(result[0].type, 'comment');
    assertEqual(result[0].content, 'Great post!');
    assertEqual(result[0].post_title, 'Original Post Title');
    assertEqual(result[0].post_id, 'post-99');
  });

  // --- getActivity: returns reactions ---
  await test('getActivity: returns reactions with post context', async () => {
    const mockActivity = [
      {
        type: 'reaction',
        created_at: '2026-07-02T08:00:00Z',
        target_id: 'reaction-1',
        post_title: 'Funny Post',
        submolt: 'humor',
        post_id: 'post-42',
        content: null,
        reaction_type: 'heart',
        target_agent_name: null,
        target_agent_display_name: null
      }
    ];
    mockQueryAllResults = [mockActivity];

    const result = await AgentService.getActivity('agent-1');
    assertEqual(result.length, 1);
    assertEqual(result[0].type, 'reaction');
    assertEqual(result[0].reaction_type, 'heart');
    assertEqual(result[0].post_title, 'Funny Post');
    assertEqual(result[0].post_id, 'post-42');
  });

  // --- getActivity: returns comment_reactions ---
  await test('getActivity: returns comment reactions', async () => {
    const mockActivity = [
      {
        type: 'comment_reaction',
        created_at: '2026-07-02T07:00:00Z',
        target_id: 'cr-1',
        post_title: 'Discussion Post',
        submolt: 'meta',
        post_id: 'post-55',
        content: null,
        reaction_type: 'thumbs_up',
        target_agent_name: null,
        target_agent_display_name: null
      }
    ];
    mockQueryAllResults = [mockActivity];

    const result = await AgentService.getActivity('agent-1');
    assertEqual(result.length, 1);
    assertEqual(result[0].type, 'comment_reaction');
    assertEqual(result[0].reaction_type, 'thumbs_up');
    assertEqual(result[0].post_title, 'Discussion Post');
  });

  // --- getActivity: returns follows with target agent info ---
  await test('getActivity: returns follows with target agent info', async () => {
    const mockActivity = [
      {
        type: 'follow',
        created_at: '2026-07-02T06:00:00Z',
        target_id: 'follow-1',
        post_title: null,
        submolt: null,
        post_id: null,
        content: null,
        reaction_type: null,
        target_agent_name: 'cool_bot',
        target_agent_display_name: 'Cool Bot'
      }
    ];
    mockQueryAllResults = [mockActivity];

    const result = await AgentService.getActivity('agent-1');
    assertEqual(result.length, 1);
    assertEqual(result[0].type, 'follow');
    assertEqual(result[0].target_agent_name, 'cool_bot');
    assertEqual(result[0].target_agent_display_name, 'Cool Bot');
  });

  // --- getActivity: mixed activity sorted by created_at DESC ---
  await test('getActivity: returns mixed activity types', async () => {
    const mockActivity = [
      { type: 'post', created_at: '2026-07-02T10:00:00Z', target_id: 'p1', post_title: 'Post 1', submolt: 'general', post_id: null, content: null, reaction_type: null, target_agent_name: null, target_agent_display_name: null },
      { type: 'comment', created_at: '2026-07-02T09:00:00Z', target_id: 'c1', post_title: 'Post 2', submolt: 'tech', post_id: 'p2', content: 'Nice!', reaction_type: null, target_agent_name: null, target_agent_display_name: null },
      { type: 'follow', created_at: '2026-07-02T08:00:00Z', target_id: 'f1', post_title: null, submolt: null, post_id: null, content: null, reaction_type: null, target_agent_name: 'other_bot', target_agent_display_name: 'Other Bot' }
    ];
    mockQueryAllResults = [mockActivity];

    const result = await AgentService.getActivity('agent-1');
    assertEqual(result.length, 3);
    assertEqual(result[0].type, 'post');
    assertEqual(result[1].type, 'comment');
    assertEqual(result[2].type, 'follow');
  });

  // --- getActivity: type filter ---
  await test('getActivity: type filter shows only specified type', async () => {
    mockQueryAllResults = [[]];

    await AgentService.getActivity('agent-1', { type: 'post' });
    const queryCall = calls.find(c => c.fn === 'queryAll');
    assert(queryCall, 'should call queryAll');
    assert(queryCall.text.includes("'post'"), 'should include post query');
    assert(!queryCall.text.includes('UNION ALL'), 'should NOT use UNION ALL for single type');
    assert(!queryCall.text.includes("'comment'"), 'should NOT include comment query');
    assert(!queryCall.text.includes("'follow'"), 'should NOT include follow query');
  });

  await test('getActivity: type filter for comments only', async () => {
    mockQueryAllResults = [[]];

    await AgentService.getActivity('agent-1', { type: 'comment' });
    const queryCall = calls.find(c => c.fn === 'queryAll');
    assert(queryCall.text.includes("'comment'"), 'should include comment query');
    assert(!queryCall.text.includes("'post'"), 'should NOT include post query');
  });

  await test('getActivity: type filter for follow only', async () => {
    mockQueryAllResults = [[]];

    await AgentService.getActivity('agent-1', { type: 'follow' });
    const queryCall = calls.find(c => c.fn === 'queryAll');
    assert(queryCall.text.includes("'follow'"), 'should include follow query');
    assert(!queryCall.text.includes("'post'"), 'should NOT include post query');
  });

  await test('getActivity: invalid type throws BadRequestError', async () => {
    try {
      await AgentService.getActivity('agent-1', { type: 'invalid' });
      throw new Error('Should have thrown');
    } catch (err) {
      assertEqual(err.constructor.name, 'BadRequestError');
      assert(err.message.includes('Invalid activity type'), 'should mention invalid type');
    }
  });

  // --- getActivity: pagination ---
  await test('getActivity: passes limit and offset to query', async () => {
    mockQueryAllResults = [[]];

    await AgentService.getActivity('agent-1', { limit: 10, offset: 20 });
    const queryCall = calls.find(c => c.fn === 'queryAll');
    assertEqual(queryCall.params[0], 'agent-1', 'first param should be agentId');
    assertEqual(queryCall.params[1], 10, 'second param should be limit');
    assertEqual(queryCall.params[2], 20, 'third param should be offset');
  });

  await test('getActivity: default limit is 25 and offset is 0', async () => {
    mockQueryAllResults = [[]];

    await AgentService.getActivity('agent-1');
    const queryCall = calls.find(c => c.fn === 'queryAll');
    assertEqual(queryCall.params[1], 25, 'default limit should be 25');
    assertEqual(queryCall.params[2], 0, 'default offset should be 0');
  });

  // --- getActivity: ORDER BY ---
  await test('getActivity: orders by created_at DESC', async () => {
    mockQueryAllResults = [[]];

    await AgentService.getActivity('agent-1');
    const queryCall = calls.find(c => c.fn === 'queryAll');
    assert(queryCall.text.includes('ORDER BY created_at DESC'), 'should order by created_at DESC');
  });

  // --- getActivity: SQL structure ---
  await test('getActivity: joins posts table for comments', async () => {
    mockQueryAllResults = [[]];

    await AgentService.getActivity('agent-1');
    const queryCall = calls.find(c => c.fn === 'queryAll');
    assert(queryCall.text.includes('JOIN posts p ON c.post_id = p.id'), 'should join posts for comments');
  });

  await test('getActivity: joins agents table for follows', async () => {
    mockQueryAllResults = [[]];

    await AgentService.getActivity('agent-1');
    const queryCall = calls.find(c => c.fn === 'queryAll');
    assert(queryCall.text.includes('JOIN agents a ON f.followed_id = a.id'), 'should join agents for follows');
  });

  // Summary
  console.log(`\n${passed + failed} tests, ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})();
