/**
 * Follows Test Suite
 *
 * Run: node test/follows.test.js
 */

// Mock database before requiring service
const calls = [];
let mockQueryOneResults = [];
let mockQueryAllResults = [];
let mockTransactionFn = null;

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

// Mock NotificationService before requiring AgentService
let notificationCalls = [];
let mockNotificationError = null;

require.cache[require.resolve('../src/services/NotificationService')] = {
  id: require.resolve('../src/services/NotificationService'),
  filename: require.resolve('../src/services/NotificationService'),
  loaded: true,
  exports: {
    create: async (data) => {
      notificationCalls.push(data);
      if (mockNotificationError) throw mockNotificationError;
      return { id: 'notif-1' };
    }
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
  notificationCalls = [];
  mockNotificationError = null;
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
  console.log('AgentService follow tests:\n');

  // --- follow ---
  await test('follow: follows an agent successfully', async () => {
    mockQueryOneResults = [
      null // not already following
    ];

    const result = await AgentService.follow('agent-1', 'agent-2');
    assertEqual(result.action, 'followed');
    assert(calls.some(c => c.fn === 'transaction'), 'should use transaction');
    assert(calls.some(c => c.fn === 'client.query' && c.text.includes('INSERT INTO follows')), 'should insert follow');
    assert(calls.some(c => c.fn === 'client.query' && c.text.includes('following_count')), 'should update following_count');
    assert(calls.some(c => c.fn === 'client.query' && c.text.includes('follower_count')), 'should update follower_count');
  });

  await test('follow: throws BadRequestError on self-follow', async () => {
    try {
      await AgentService.follow('agent-1', 'agent-1');
      throw new Error('Should have thrown');
    } catch (err) {
      assertEqual(err.constructor.name, 'BadRequestError');
      assert(err.message.includes('Cannot follow yourself'), 'should say cannot follow yourself');
    }
  });

  await test('follow: returns already_following if duplicate', async () => {
    mockQueryOneResults = [
      { id: 'follow-1' } // already following
    ];

    const result = await AgentService.follow('agent-1', 'agent-2');
    assertEqual(result.action, 'already_following');
    assert(!calls.some(c => c.fn === 'transaction'), 'should not use transaction');
  });

  await test('follow: creates notification for followed agent', async () => {
    mockQueryOneResults = [null]; // not already following

    await AgentService.follow('agent-1', 'agent-2');
    assertEqual(notificationCalls.length, 1, 'should create one notification');
    assertEqual(notificationCalls[0].recipientId, 'agent-2', 'recipientId should be followed agent');
    assertEqual(notificationCalls[0].actorId, 'agent-1', 'actorId should be follower');
    assertEqual(notificationCalls[0].type, 'follow', 'type should be follow');
    assertEqual(notificationCalls[0].title, 'Started following you', 'title should match');
  });

  await test('follow: does not create notification on already_following', async () => {
    mockQueryOneResults = [{ id: 'follow-1' }]; // already following

    await AgentService.follow('agent-1', 'agent-2');
    assertEqual(notificationCalls.length, 0, 'should not create notification');
  });

  await test('follow: handles notification error gracefully', async () => {
    mockQueryOneResults = [null]; // not already following
    mockNotificationError = new Error('Notification service down');

    const result = await AgentService.follow('agent-1', 'agent-2');
    assertEqual(result.success, true, 'follow should still succeed');
    assertEqual(result.action, 'followed', 'action should be followed');
    assertEqual(notificationCalls.length, 1, 'should have attempted notification');
  });

  // --- unfollow ---
  await test('unfollow: unfollows an agent successfully', async () => {
    mockQueryOneResults = [
      { id: 'follow-1' }, // delete returns row
      null,               // update following_count
      null                // update follower_count
    ];

    const result = await AgentService.unfollow('agent-1', 'agent-2');
    assertEqual(result.action, 'unfollowed');
    assert(calls[0].text.includes('DELETE FROM follows'), 'should delete follow');
  });

  await test('unfollow: returns not_following if not found', async () => {
    mockQueryOneResults = [null]; // delete returns nothing

    const result = await AgentService.unfollow('agent-1', 'agent-2');
    assertEqual(result.action, 'not_following');
    assertEqual(calls.length, 1, 'should not update counts');
  });

  // --- isFollowing ---
  await test('isFollowing: returns true when following', async () => {
    mockQueryOneResults = [{ id: 'follow-1' }];

    const result = await AgentService.isFollowing('agent-1', 'agent-2');
    assertEqual(result, true);
    assert(calls[0].text.includes('SELECT id FROM follows'), 'should query follows');
  });

  await test('isFollowing: returns false when not following', async () => {
    mockQueryOneResults = [null];

    const result = await AgentService.isFollowing('agent-1', 'agent-2');
    assertEqual(result, false);
  });

  // --- getFollowers ---
  await test('getFollowers: returns list of followers', async () => {
    const mockFollowers = [
      { name: 'bot_a', display_name: 'Bot A', description: 'A bot', karma: 100, created_at: '2026-01-01' },
      { name: 'bot_b', display_name: 'Bot B', description: 'Another bot', karma: 50, created_at: '2026-02-01' }
    ];
    mockQueryAllResults = [mockFollowers];

    const result = await AgentService.getFollowers('agent-1', { limit: 25, offset: 0 });
    assertEqual(result.length, 2);
    assertEqual(result[0].name, 'bot_a');
    assertEqual(result[1].name, 'bot_b');
    assert(calls[0].text.includes('JOIN follows f ON a.id = f.follower_id'), 'should join on follower_id');
    assert(calls[0].text.includes('f.followed_id = $1'), 'should filter by followed agent');
  });

  await test('getFollowers: returns empty array when no followers', async () => {
    mockQueryAllResults = [[]];

    const result = await AgentService.getFollowers('agent-1', { limit: 25, offset: 0 });
    assertEqual(result.length, 0);
  });

  await test('getFollowers: passes pagination params correctly', async () => {
    mockQueryAllResults = [[]];

    await AgentService.getFollowers('agent-1', { limit: 10, offset: 5 });
    assertEqual(calls[0].params[1], 10, 'limit should be 10');
    assertEqual(calls[0].params[2], 5, 'offset should be 5');
  });

  // --- getFollowing ---
  await test('getFollowing: returns list of followed agents', async () => {
    const mockFollowing = [
      { name: 'bot_c', display_name: 'Bot C', description: 'C bot', karma: 200, created_at: '2026-03-01' }
    ];
    mockQueryAllResults = [mockFollowing];

    const result = await AgentService.getFollowing('agent-1', { limit: 25, offset: 0 });
    assertEqual(result.length, 1);
    assertEqual(result[0].name, 'bot_c');
    assert(calls[0].text.includes('JOIN follows f ON a.id = f.followed_id'), 'should join on followed_id');
    assert(calls[0].text.includes('f.follower_id = $1'), 'should filter by follower agent');
  });

  await test('getFollowing: returns empty array when not following anyone', async () => {
    mockQueryAllResults = [[]];

    const result = await AgentService.getFollowing('agent-1', { limit: 25, offset: 0 });
    assertEqual(result.length, 0);
  });

  await test('getFollowing: passes pagination params correctly', async () => {
    mockQueryAllResults = [[]];

    await AgentService.getFollowing('agent-1', { limit: 15, offset: 10 });
    assertEqual(calls[0].params[1], 15, 'limit should be 15');
    assertEqual(calls[0].params[2], 10, 'offset should be 10');
  });

  // Summary
  console.log(`\n${passed + failed} tests, ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})();
