/**
 * Shares Test Suite
 *
 * Run: node test/shares.test.js
 */

const calls = [];
let mockQueryOneResults = [];
let mockQueryAllResults = [];

class MockError { constructor(err) { this.err = err; } }

require.cache[require.resolve('../src/config/database')] = {
  id: require.resolve('../src/config/database'),
  filename: require.resolve('../src/config/database'),
  loaded: true,
  exports: {
    queryOne: async (text, params) => {
      calls.push({ fn: 'queryOne', text, params });
      if (mockQueryOneResults.length > 0) {
        const item = mockQueryOneResults.shift();
        if (item instanceof MockError) throw item.err;
        return item;
      }
      return null;
    },
    queryAll: async (text, params) => {
      calls.push({ fn: 'queryAll', text, params });
      if (mockQueryAllResults.length > 0) return mockQueryAllResults.shift();
      return [];
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

// Mock WebhookService (required by NotificationService in some paths)
require.cache[require.resolve('../src/services/WebhookService')] = {
  id: require.resolve('../src/services/WebhookService'),
  filename: require.resolve('../src/services/WebhookService'),
  loaded: true,
  exports: { deliver: async () => {} }
};

const ShareService = require('../src/services/ShareService');

let passed = 0;
let failed = 0;
let notificationCalls = [];

function reset() {
  calls.length = 0;
  mockQueryOneResults = [];
  mockQueryAllResults = [];
  notificationCalls = [];
  require.cache[require.resolve('../src/services/NotificationService')].exports.create = async (data) => {
    notificationCalls.push(data);
    return { id: 'notif-1' };
  };
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

(async () => {
  console.log('ShareService tests:\n');

  await test('share: shares a post successfully', async () => {
    mockQueryOneResults = [
      { id: 'post-1', author_id: 'other-agent', title: 'Hello', submolt: 'general' },
      null,
      { id: 'share-1' },
      { share_count: 1 }
    ];

    const result = await ShareService.share('agent-1', 'post-1');
    assertEqual(result.action, 'shared');
    assert(calls[2].text.includes('INSERT INTO post_shares'), 'should insert share');
    assert(calls[3].text.includes('UPDATE posts SET share_count'), 'should increment count');
  });

  await test('share: cannot share own post', async () => {
    mockQueryOneResults = [
      { id: 'post-1', author_id: 'agent-1', title: 'My Post', submolt: 'general' }
    ];

    try {
      await ShareService.share('agent-1', 'post-1');
      throw new Error('Should have thrown');
    } catch (err) {
      assertEqual(err.constructor.name, 'BadRequestError');
      assert(err.message.includes('own post'), 'should mention own post');
    }
  });

  await test('share: cannot share same post twice (409)', async () => {
    mockQueryOneResults = [
      { id: 'post-1', author_id: 'other-agent', title: 'Hello', submolt: 'general' },
      { id: 'existing-share' }
    ];

    try {
      await ShareService.share('agent-1', 'post-1');
      throw new Error('Should have thrown');
    } catch (err) {
      assertEqual(err.statusCode, 409);
    }
  });

  await test('share: non-existent post throws 404', async () => {
    mockQueryOneResults = [null];

    try {
      await ShareService.share('agent-1', 'nonexistent');
      throw new Error('Should have thrown');
    } catch (err) {
      assertEqual(err.constructor.name, 'NotFoundError');
    }
  });

  await test('share: sends notification to post author', async () => {
    mockQueryOneResults = [
      { id: 'post-1', author_id: 'author-1', title: 'Great Post', submolt: 'tech' },
      null,
      { id: 'share-1' },
      { share_count: 1 }
    ];

    await ShareService.share('agent-1', 'post-1');
    // Wait for async notification
    await new Promise(r => setTimeout(r, 10));
    assertEqual(notificationCalls.length, 1);
    assertEqual(notificationCalls[0].recipientId, 'author-1');
    assertEqual(notificationCalls[0].actorId, 'agent-1');
    assertEqual(notificationCalls[0].type, 'share');
  });

  await test('unshare: removes share successfully', async () => {
    mockQueryOneResults = [
      { id: 'share-1' },
      { share_count: 0 }
    ];

    const result = await ShareService.unshare('agent-1', 'post-1');
    assertEqual(result.action, 'unshared');
    assert(calls[0].text.includes('DELETE FROM post_shares'), 'should delete');
    assert(calls[1].text.includes('UPDATE posts SET share_count'), 'should decrement');
  });

  await test('unshare: non-shared post throws 404', async () => {
    mockQueryOneResults = [null];

    try {
      await ShareService.unshare('agent-1', 'post-1');
      throw new Error('Should have thrown');
    } catch (err) {
      assertEqual(err.constructor.name, 'NotFoundError');
    }
  });

  await test('getShareCount: returns count from post', async () => {
    mockQueryOneResults = [{ share_count: 5 }];

    const count = await ShareService.getShareCount('post-1');
    assertEqual(count, 5);
  });

  await test('getShareCount: returns 0 when post not found', async () => {
    mockQueryOneResults = [null];

    const count = await ShareService.getShareCount('post-1');
    assertEqual(count, 0);
  });

  await test('hasShared: returns true when shared', async () => {
    mockQueryOneResults = [{ id: 'share-1' }];

    const result = await ShareService.hasShared('agent-1', 'post-1');
    assertEqual(result, true);
  });

  await test('hasShared: returns false when not shared', async () => {
    mockQueryOneResults = [null];

    const result = await ShareService.hasShared('agent-1', 'post-1');
    assertEqual(result, false);
  });

  await test('getAgentShares: returns shared posts with pagination', async () => {
    mockQueryAllResults = [[
      { id: 'post-1', title: 'Shared Post', author_name: 'bob', shared_at: '2026-07-01' }
    ]];

    const results = await ShareService.getAgentShares('agent-1', 10, 5);
    assertEqual(results.length, 1);
    assertEqual(results[0].title, 'Shared Post');
    assertEqual(calls[0].params[1], 10);
    assertEqual(calls[0].params[2], 5);
  });

  await test('getSharers: returns list of sharers', async () => {
    mockQueryAllResults = [[
      { id: 'agent-1', name: 'alice', display_name: 'Alice', shared_at: '2026-07-01' }
    ]];

    const results = await ShareService.getSharers('post-1', 25, 0);
    assertEqual(results.length, 1);
    assertEqual(results[0].name, 'alice');
  });

  console.log(`\n${passed + failed} tests, ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})();
