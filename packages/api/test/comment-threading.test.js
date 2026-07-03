/**
 * Comment Threading Test Suite
 *
 * Run: node test/comment-threading.test.js
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
    transaction: async (fn) => fn({ queryOne: async () => null, queryAll: async () => [] })
  }
};

// Mock PostService
const postServiceCalls = [];
require.cache[require.resolve('../src/services/PostService')] = {
  id: require.resolve('../src/services/PostService'),
  filename: require.resolve('../src/services/PostService'),
  loaded: true,
  exports: {
    incrementCommentCount: async (postId) => {
      postServiceCalls.push({ fn: 'incrementCommentCount', postId });
    }
  }
};

// Mock NotificationService
const notificationCalls = [];
require.cache[require.resolve('../src/services/NotificationService')] = {
  id: require.resolve('../src/services/NotificationService'),
  filename: require.resolve('../src/services/NotificationService'),
  loaded: true,
  exports: {
    create: async (data) => {
      notificationCalls.push(data);
    }
  }
};

// Mock AgentService
require.cache[require.resolve('../src/services/AgentService')] = {
  id: require.resolve('../src/services/AgentService'),
  filename: require.resolve('../src/services/AgentService'),
  loaded: true,
  exports: {
    findByName: async () => null
  }
};

// Mock mentions util
require.cache[require.resolve('../src/utils/mentions')] = {
  id: require.resolve('../src/utils/mentions'),
  filename: require.resolve('../src/utils/mentions'),
  loaded: true,
  exports: {
    parseMentions: () => []
  }
};

const CommentService = require('../src/services/CommentService');

// Test framework
let passed = 0;
let failed = 0;
const tests = [];

function describe(name, fn) {
  tests.push({ type: 'describe', name });
  fn();
}

function test(name, fn) {
  tests.push({ type: 'test', name, fn });
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

function assertEqual(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(message || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function resetMocks() {
  calls.length = 0;
  mockQueryOneResults = [];
  mockQueryAllResults = [];
  postServiceCalls.length = 0;
  notificationCalls.length = 0;
}

async function runTests() {
  console.log('\nComment Threading Test Suite\n');
  console.log('='.repeat(50));

  for (const item of tests) {
    if (item.type === 'describe') {
      console.log(`\n[${item.name}]\n`);
    } else {
      resetMocks();
      try {
        await item.fn();
        console.log(`  + ${item.name}`);
        passed++;
      } catch (error) {
        console.log(`  - ${item.name}`);
        console.log(`    Error: ${error.message}`);
        failed++;
      }
    }
  }

  console.log('\n' + '='.repeat(50));
  console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

// Tests

describe('create — top-level comment', () => {
  test('creates comment with depth 0 when parentId is null', async () => {
    // queryOne #1: post exists
    mockQueryOneResults.push({ id: 'post-1' });
    // queryOne #2: INSERT RETURNING
    mockQueryOneResults.push({ id: 'c-1', content: 'Hello', score: 0, depth: 0, created_at: '2026-01-01' });
    // queryOne #3: PostService.incrementCommentCount (mocked separately)
    // queryOne #4: post info for notification
    mockQueryOneResults.push({ author_id: 'post-author', title: 'Test Post', submolt: 'general' });

    const result = await CommentService.create({
      postId: 'post-1',
      authorId: 'agent-1',
      content: 'Hello'
    });

    assertEqual(result.depth, 0);
    assertEqual(result.id, 'c-1');
    // Verify INSERT used depth=0
    const insertCall = calls.find(c => c.text.includes('INSERT INTO comments'));
    assertEqual(insertCall.params[4], 0, 'depth param should be 0');
    // Verify PostService was called
    assertEqual(postServiceCalls.length, 1);
    assertEqual(postServiceCalls[0].postId, 'post-1');
  });
});

describe('create — reply to comment', () => {
  test('creates reply with depth = parent.depth + 1', async () => {
    // queryOne #1: post exists
    mockQueryOneResults.push({ id: 'post-1' });
    // queryOne #2: parent comment exists with depth 3
    mockQueryOneResults.push({ id: 'parent-1', depth: 3 });
    // queryOne #3: INSERT RETURNING
    mockQueryOneResults.push({ id: 'c-2', content: 'Reply', score: 0, depth: 4, created_at: '2026-01-01' });
    // queryOne #4: parent comment author for notification
    mockQueryOneResults.push({ author_id: 'parent-author' });
    // queryOne #5: post info for notification link
    mockQueryOneResults.push({ title: 'Test Post', submolt: 'general' });

    const result = await CommentService.create({
      postId: 'post-1',
      authorId: 'agent-1',
      content: 'Reply',
      parentId: 'parent-1'
    });

    assertEqual(result.depth, 4);
    // Verify INSERT used depth=4
    const insertCall = calls.find(c => c.text.includes('INSERT INTO comments'));
    assertEqual(insertCall.params[3], 'parent-1', 'parentId param');
    assertEqual(insertCall.params[4], 4, 'depth param should be parent.depth + 1');
  });

  test('rejects reply when parentId does not exist on the post', async () => {
    // queryOne #1: post exists
    mockQueryOneResults.push({ id: 'post-1' });
    // queryOne #2: parent comment not found
    mockQueryOneResults.push(null);

    try {
      await CommentService.create({
        postId: 'post-1',
        authorId: 'agent-1',
        content: 'Reply',
        parentId: 'nonexistent'
      });
      assert(false, 'Should have thrown');
    } catch (err) {
      assert(err.statusCode === 404, `Expected 404, got ${err.statusCode}`);
      assert(err.message.includes('Parent comment'), `Expected "Parent comment not found", got: ${err.message}`);
    }
  });

  test('rejects reply when depth would exceed 10', async () => {
    // queryOne #1: post exists
    mockQueryOneResults.push({ id: 'post-1' });
    // queryOne #2: parent at depth 10 → reply would be depth 11
    mockQueryOneResults.push({ id: 'deep-parent', depth: 10 });

    try {
      await CommentService.create({
        postId: 'post-1',
        authorId: 'agent-1',
        content: 'Too deep',
        parentId: 'deep-parent'
      });
      assert(false, 'Should have thrown');
    } catch (err) {
      assert(err.statusCode === 400, `Expected 400, got ${err.statusCode}`);
      assert(err.message.includes('depth'), `Expected depth error, got: ${err.message}`);
    }
  });
});

describe('buildCommentTree', () => {
  test('builds nested tree from flat list', async () => {
    const flat = [
      { id: 'c1', parent_id: null, depth: 0 },
      { id: 'c2', parent_id: 'c1', depth: 1 },
      { id: 'c3', parent_id: null, depth: 0 }
    ];

    const tree = CommentService.buildCommentTree(flat);

    assertEqual(tree.length, 2, 'Should have 2 root comments');
    assertEqual(tree[0].id, 'c1');
    assertEqual(tree[0].replies.length, 1, 'c1 should have 1 reply');
    assertEqual(tree[0].replies[0].id, 'c2');
    assertEqual(tree[1].id, 'c3');
    assertEqual(tree[1].replies.length, 0, 'c3 should have no replies');
  });

  test('returns empty array for empty input', async () => {
    const tree = CommentService.buildCommentTree([]);
    assertEqual(tree, []);
  });

  test('handles multi-level nesting (depth 0→1→2)', async () => {
    const flat = [
      { id: 'root', parent_id: null, depth: 0 },
      { id: 'child', parent_id: 'root', depth: 1 },
      { id: 'grandchild', parent_id: 'child', depth: 2 }
    ];

    const tree = CommentService.buildCommentTree(flat);

    assertEqual(tree.length, 1, 'Should have 1 root');
    assertEqual(tree[0].id, 'root');
    assertEqual(tree[0].replies.length, 1);
    assertEqual(tree[0].replies[0].id, 'child');
    assertEqual(tree[0].replies[0].replies.length, 1);
    assertEqual(tree[0].replies[0].replies[0].id, 'grandchild');
    assertEqual(tree[0].replies[0].replies[0].replies.length, 0);
  });
});

describe('getByPost — sorting', () => {
  test('sort=new uses created_at DESC ordering', async () => {
    mockQueryAllResults.push([]);

    await CommentService.getByPost('post-1', { sort: 'new', limit: 50 });

    assert(calls.length === 1, 'Should make one queryAll call');
    assert(calls[0].text.includes('created_at DESC'), `Expected created_at DESC in query, got: ${calls[0].text}`);
  });

  test('sort=top uses score DESC ordering', async () => {
    mockQueryAllResults.push([]);

    await CommentService.getByPost('post-1', { sort: 'top', limit: 50 });

    assert(calls.length === 1, 'Should make one queryAll call');
    assert(calls[0].text.includes('score DESC'), `Expected score DESC in query, got: ${calls[0].text}`);
  });
});

describe('create — notifications', () => {
  test('reply notification goes to parent comment author, not post author', async () => {
    // queryOne #1: post exists
    mockQueryOneResults.push({ id: 'post-1' });
    // queryOne #2: parent comment exists
    mockQueryOneResults.push({ id: 'parent-1', depth: 0 });
    // queryOne #3: INSERT RETURNING
    mockQueryOneResults.push({ id: 'c-reply', content: 'Nice point', score: 0, depth: 1, created_at: '2026-01-01' });
    // queryOne #4: parent comment author lookup for notification
    mockQueryOneResults.push({ author_id: 'parent-author-id' });
    // queryOne #5: post info for notification link
    mockQueryOneResults.push({ title: 'Post Title', submolt: 'tech' });

    await CommentService.create({
      postId: 'post-1',
      authorId: 'replier-id',
      content: 'Nice point',
      parentId: 'parent-1'
    });

    assertEqual(notificationCalls.length, 1, 'Should create exactly 1 notification');
    assertEqual(notificationCalls[0].recipientId, 'parent-author-id', 'Notification should go to parent comment author');
    assertEqual(notificationCalls[0].type, 'reply');
    assertEqual(notificationCalls[0].actorId, 'replier-id');
    assertEqual(notificationCalls[0].postId, 'post-1');
    assertEqual(notificationCalls[0].commentId, 'c-reply');
  });
});

// Run
runTests();
