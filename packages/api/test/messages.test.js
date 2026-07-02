/**
 * Messages Test Suite
 *
 * Run: node test/messages.test.js
 */

// Mock database before requiring service
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

// Mock NotificationService before requiring MessageService
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

const MessageService = require('../src/services/MessageService');

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
  console.log('MessageService tests:\n');

  // --- send ---
  await test('send: sends a message successfully', async () => {
    const mockMessage = {
      id: 'msg-1',
      sender_id: 'agent-1',
      recipient_id: 'agent-2',
      content: 'Hello!',
      read: false,
      created_at: '2026-07-01T00:00:00Z'
    };
    mockQueryOneResults = [
      { id: 'agent-2' },  // recipient exists check
      mockMessage          // INSERT returning
    ];

    const result = await MessageService.send('agent-1', 'agent-2', 'Hello!');
    assertEqual(result.id, 'msg-1');
    assertEqual(result.content, 'Hello!');
    assert(calls.some(c => c.fn === 'queryOne' && c.text.includes('INSERT INTO direct_messages')), 'should insert message');
  });

  await test('send: throws BadRequestError on self-message', async () => {
    try {
      await MessageService.send('agent-1', 'agent-1', 'Hi me');
      throw new Error('Should have thrown');
    } catch (err) {
      assertEqual(err.constructor.name, 'BadRequestError');
      assert(err.message.includes('Cannot send a message to yourself'));
    }
  });

  await test('send: throws BadRequestError on empty content', async () => {
    try {
      await MessageService.send('agent-1', 'agent-2', '');
      throw new Error('Should have thrown');
    } catch (err) {
      assertEqual(err.constructor.name, 'BadRequestError');
      assert(err.message.includes('content'));
    }
  });

  await test('send: throws BadRequestError on whitespace-only content', async () => {
    try {
      await MessageService.send('agent-1', 'agent-2', '   \n\t  ');
      throw new Error('Should have thrown');
    } catch (err) {
      assertEqual(err.constructor.name, 'BadRequestError');
      assert(err.message.includes('empty'));
    }
  });

  await test('send: throws BadRequestError on content exceeding 10000 chars', async () => {
    const longContent = 'x'.repeat(10001);
    mockQueryOneResults = [
      { id: 'agent-2' }  // recipient exists
    ];
    try {
      await MessageService.send('agent-1', 'agent-2', longContent);
      throw new Error('Should have thrown');
    } catch (err) {
      assertEqual(err.constructor.name, 'BadRequestError');
      assert(err.message.includes('10000'));
    }
  });

  await test('send: throws NotFoundError when recipient does not exist', async () => {
    mockQueryOneResults = [null]; // recipient not found

    try {
      await MessageService.send('agent-1', 'agent-999', 'Hello');
      throw new Error('Should have thrown');
    } catch (err) {
      assertEqual(err.constructor.name, 'NotFoundError');
      assert(err.message.includes('not found'));
    }
  });

  await test('send: trims content before storing', async () => {
    const mockMessage = {
      id: 'msg-2',
      sender_id: 'agent-1',
      recipient_id: 'agent-2',
      content: 'Hello!',
      read: false,
      created_at: '2026-07-01T00:00:00Z'
    };
    mockQueryOneResults = [
      { id: 'agent-2' },  // recipient exists
      mockMessage          // INSERT returning
    ];

    await MessageService.send('agent-1', 'agent-2', '  Hello!  ');
    const insertCall = calls.find(c => c.fn === 'queryOne' && c.text.includes('INSERT'));
    assertEqual(insertCall.params[2], 'Hello!', 'content should be trimmed');
  });

  await test('send: creates notification for recipient', async () => {
    const mockMessage = {
      id: 'msg-3',
      sender_id: 'agent-1',
      recipient_id: 'agent-2',
      content: 'Hey there',
      read: false,
      created_at: '2026-07-01T00:00:00Z'
    };
    mockQueryOneResults = [
      { id: 'agent-2' },
      mockMessage
    ];

    await MessageService.send('agent-1', 'agent-2', 'Hey there');
    // Give fire-and-forget a tick to resolve
    await new Promise(r => setTimeout(r, 10));
    assertEqual(notificationCalls.length, 1, 'should create one notification');
    assertEqual(notificationCalls[0].recipientId, 'agent-2');
    assertEqual(notificationCalls[0].actorId, 'agent-1');
    assertEqual(notificationCalls[0].type, 'direct_message');
  });

  await test('send: notification error does not break send', async () => {
    mockNotificationError = new Error('Notification service down');
    const mockMessage = {
      id: 'msg-4',
      sender_id: 'agent-1',
      recipient_id: 'agent-2',
      content: 'Still works',
      read: false,
      created_at: '2026-07-01T00:00:00Z'
    };
    mockQueryOneResults = [
      { id: 'agent-2' },
      mockMessage
    ];

    const result = await MessageService.send('agent-1', 'agent-2', 'Still works');
    assertEqual(result.id, 'msg-4', 'message should still be created');
  });

  await test('send: throws BadRequestError on null content', async () => {
    try {
      await MessageService.send('agent-1', 'agent-2', null);
      throw new Error('Should have thrown');
    } catch (err) {
      assertEqual(err.constructor.name, 'BadRequestError');
      assert(err.message.includes('required'));
    }
  });

  // --- getConversations ---
  await test('getConversations: returns conversation list', async () => {
    const mockConversations = [
      {
        agent_id: 'agent-2',
        agent_name: 'bot_b',
        agent_display_name: 'Bot B',
        agent_avatar_url: null,
        last_message_content: 'Hey!',
        last_message_sender_id: 'agent-2',
        last_message_at: '2026-07-01T12:00:00Z',
        unread_count: 3
      }
    ];
    mockQueryAllResults = [mockConversations];

    const result = await MessageService.getConversations('agent-1', { limit: 25, offset: 0 });
    assertEqual(result.length, 1);
    assertEqual(result[0].agent_name, 'bot_b');
    assertEqual(result[0].unread_count, 3);
    assert(calls[0].params[0] === 'agent-1', 'should pass agentId');
  });

  await test('getConversations: returns empty array when no conversations', async () => {
    mockQueryAllResults = [[]];

    const result = await MessageService.getConversations('agent-1', { limit: 25, offset: 0 });
    assertEqual(result.length, 0);
  });

  await test('getConversations: passes pagination params correctly', async () => {
    mockQueryAllResults = [[]];

    await MessageService.getConversations('agent-1', { limit: 10, offset: 5 });
    assertEqual(calls[0].params[1], 10, 'limit should be 10');
    assertEqual(calls[0].params[2], 5, 'offset should be 5');
  });

  // --- getMessages ---
  await test('getMessages: returns messages between two agents', async () => {
    const mockMessages = [
      { id: 'msg-1', sender_id: 'agent-1', recipient_id: 'agent-2', content: 'Hi', read: true, created_at: '2026-07-01T12:01:00Z' },
      { id: 'msg-2', sender_id: 'agent-2', recipient_id: 'agent-1', content: 'Hey', read: false, created_at: '2026-07-01T12:00:00Z' }
    ];
    mockQueryAllResults = [mockMessages];

    const result = await MessageService.getMessages('agent-1', 'agent-2', { limit: 50, offset: 0 });
    assertEqual(result.length, 2);
    assert(calls[0].text.includes('sender_id = $1 AND recipient_id = $2'), 'should query both directions');
    assert(calls[0].text.includes('sender_id = $2 AND recipient_id = $1'), 'should query both directions');
  });

  await test('getMessages: passes pagination params correctly', async () => {
    mockQueryAllResults = [[]];

    await MessageService.getMessages('agent-1', 'agent-2', { limit: 20, offset: 10 });
    assertEqual(calls[0].params[2], 20, 'limit should be 20');
    assertEqual(calls[0].params[3], 10, 'offset should be 10');
  });

  // --- markRead ---
  await test('markRead: marks messages as read', async () => {
    mockQueryOneResults = [{ id: 'msg-1' }]; // UPDATE returns a row

    const result = await MessageService.markRead('agent-1', 'agent-2');
    assertEqual(result.marked, true);
    assert(calls[0].text.includes('UPDATE direct_messages'), 'should update messages');
    assert(calls[0].text.includes('recipient_id = $1'), 'should filter by recipient');
    assert(calls[0].text.includes('sender_id = $2'), 'should filter by sender');
  });

  await test('markRead: returns marked false when no unread messages', async () => {
    mockQueryOneResults = [null]; // no rows updated

    const result = await MessageService.markRead('agent-1', 'agent-2');
    assertEqual(result.marked, false);
  });

  // --- getUnreadCount ---
  await test('getUnreadCount: returns count of unread messages', async () => {
    mockQueryOneResults = [{ count: 7 }];

    const result = await MessageService.getUnreadCount('agent-1');
    assertEqual(result, 7);
    assert(calls[0].text.includes('COUNT(*)'), 'should count messages');
    assert(calls[0].text.includes('recipient_id = $1'), 'should filter by recipient');
    assert(calls[0].text.includes('read = false'), 'should filter unread');
  });

  await test('getUnreadCount: returns 0 when no unread messages', async () => {
    mockQueryOneResults = [{ count: 0 }];

    const result = await MessageService.getUnreadCount('agent-1');
    assertEqual(result, 0);
  });

  // Summary
  console.log(`\n${passed + failed} tests, ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})();
