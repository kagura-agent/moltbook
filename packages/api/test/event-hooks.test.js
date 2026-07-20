/**
 * Event Hooks Test Suite
 *
 * Run: node test/event-hooks.test.js
 */

const crypto = require('crypto');

// Mock database
const calls = [];
let mockQueryAllResults = [];
let mockQueryOneResults = [];

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

// Mock fetch
let fetchCalls = [];
global.fetch = async (url, opts) => {
  fetchCalls.push({ url, opts });
  return { ok: true, status: 200 };
};

const EventHookService = require('../src/services/EventHookService');

// Test framework
let passed = 0;
let failed = 0;

function reset() {
  calls.length = 0;
  mockQueryAllResults = [];
  mockQueryOneResults = [];
  fetchCalls = [];
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
  console.log('EventHookService Tests\n');

  // --- Registration Tests ---

  await test('register: creates hook with valid params', async () => {
    mockQueryOneResults.push({ count: 0 });
    mockQueryOneResults.push({ id: 'hook-1', event_type: 'new_post', target_url: 'https://example.com/hook', enabled: true, created_at: '2024-01-01' });

    const hook = await EventHookService.register('agent-1', {
      event_type: 'new_post',
      target_url: 'https://example.com/hook',
      secret: 'my-secret-key-123'
    });

    assertEqual(hook.id, 'hook-1');
    assertEqual(hook.event_type, 'new_post');
  });

  await test('register: rejects invalid event_type', async () => {
    try {
      await EventHookService.register('agent-1', {
        event_type: 'invalid_event',
        target_url: 'https://example.com/hook',
        secret: 'my-secret-key-123'
      });
      assert(false, 'Should have thrown');
    } catch (err) {
      assert(err.message.includes('Invalid event_type'));
    }
  });

  await test('register: rejects invalid URL', async () => {
    try {
      await EventHookService.register('agent-1', {
        event_type: 'new_post',
        target_url: 'not-a-url',
        secret: 'my-secret-key-123'
      });
      assert(false, 'Should have thrown');
    } catch (err) {
      assert(err.message.includes('Invalid target_url'));
    }
  });

  await test('register: rejects short secret', async () => {
    try {
      await EventHookService.register('agent-1', {
        event_type: 'new_post',
        target_url: 'https://example.com/hook',
        secret: 'short'
      });
      assert(false, 'Should have thrown');
    } catch (err) {
      assert(err.message.includes('secret is required'));
    }
  });

  await test('register: enforces max 5 hooks per agent', async () => {
    mockQueryOneResults.push({ count: 5 });

    try {
      await EventHookService.register('agent-1', {
        event_type: 'new_post',
        target_url: 'https://example.com/hook',
        secret: 'my-secret-key-123'
      });
      assert(false, 'Should have thrown');
    } catch (err) {
      assert(err.message.includes('Maximum of 5'));
    }
  });

  await test('register: rejects missing target_url', async () => {
    try {
      await EventHookService.register('agent-1', {
        event_type: 'new_post',
        target_url: '',
        secret: 'my-secret-key-123'
      });
      assert(false, 'Should have thrown');
    } catch (err) {
      assert(err.message.includes('target_url is required'));
    }
  });

  // --- List Tests ---

  await test('list: returns agent hooks', async () => {
    mockQueryAllResults.push([
      { id: 'hook-1', event_type: 'new_post', target_url: 'https://a.com', enabled: true },
      { id: 'hook-2', event_type: 'new_comment', target_url: 'https://b.com', enabled: true }
    ]);

    const hooks = await EventHookService.list('agent-1');
    assertEqual(hooks.length, 2);
    assert(calls[0].params[0] === 'agent-1');
  });

  // --- Remove Tests ---

  await test('remove: deletes own hook', async () => {
    mockQueryOneResults.push({ agent_id: 'agent-1' });
    mockQueryOneResults.push({ id: 'hook-1' });

    await EventHookService.remove('agent-1', 'hook-1');
    assert(calls[1].text.includes('DELETE'));
  });

  await test('remove: rejects deleting another agent hook', async () => {
    mockQueryOneResults.push({ agent_id: 'agent-2' });

    try {
      await EventHookService.remove('agent-1', 'hook-1');
      assert(false, 'Should have thrown');
    } catch (err) {
      assert(err.statusCode === 404);
    }
  });

  await test('remove: throws not found for missing hook', async () => {
    mockQueryOneResults.push(null);

    try {
      await EventHookService.remove('agent-1', 'nonexistent');
      assert(false, 'Should have thrown');
    } catch (err) {
      assert(err.statusCode === 404);
    }
  });

  // --- Fire Tests ---

  await test('fire: delivers to matching hooks with HMAC signature', async () => {
    mockQueryAllResults.push([
      { id: 'hook-1', target_url: 'https://a.com/hook', secret: 'secret123' }
    ]);

    await EventHookService._fireAsync('new_post', { post_id: 'p1' });

    assertEqual(fetchCalls.length, 1);
    assertEqual(fetchCalls[0].url, 'https://a.com/hook');

    const body = fetchCalls[0].opts.body;
    const parsed = JSON.parse(body);
    assertEqual(parsed.event, 'new_post');
    assertEqual(parsed.payload.post_id, 'p1');

    const expectedSig = crypto.createHmac('sha256', 'secret123').update(body).digest('hex');
    assertEqual(fetchCalls[0].opts.headers['X-Moltbook-Signature'], expectedSig);
  });

  await test('fire: does nothing when no hooks match', async () => {
    mockQueryAllResults.push([]);

    await EventHookService._fireAsync('new_post', { post_id: 'p1' });
    assertEqual(fetchCalls.length, 0);
  });

  await test('computeSignature: produces correct HMAC-SHA256', () => {
    const sig = EventHookService.computeSignature('hello', 'secret');
    const expected = crypto.createHmac('sha256', 'secret').update('hello').digest('hex');
    assertEqual(sig, expected);
  });

  // --- Summary ---
  console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  process.exit(failed > 0 ? 1 : 0);
})();
