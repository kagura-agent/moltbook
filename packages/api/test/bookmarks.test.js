/**
 * Bookmarks Test Suite
 *
 * Run: node test/bookmarks.test.js
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
    }
  }
};

const BookmarkService = require('../src/services/BookmarkService');

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
  console.log('BookmarkService tests:\n');

  // --- add ---
  await test('add: bookmarks a post successfully', async () => {
    mockQueryOneResults = [
      { id: 'post-1' },     // post exists check
      null,                   // not already bookmarked
      { id: 'bm-1' }        // insert result
    ];

    const result = await BookmarkService.add('agent-1', 'post-1');
    assertEqual(result.action, 'bookmarked');
    assertEqual(calls.length, 3);
    assert(calls[0].text.includes('SELECT id FROM posts'), 'should check post exists');
    assert(calls[1].text.includes('SELECT id FROM bookmarks'), 'should check existing');
    assert(calls[2].text.includes('INSERT INTO bookmarks'), 'should insert');
  });

  await test('add: returns already_bookmarked if duplicate', async () => {
    mockQueryOneResults = [
      { id: 'post-1' },     // post exists
      { id: 'bm-1' }        // already bookmarked
    ];

    const result = await BookmarkService.add('agent-1', 'post-1');
    assertEqual(result.action, 'already_bookmarked');
    assertEqual(calls.length, 2, 'should not insert');
  });

  await test('add: throws NotFoundError if post does not exist', async () => {
    mockQueryOneResults = [null]; // post not found

    try {
      await BookmarkService.add('agent-1', 'nonexistent');
      throw new Error('Should have thrown');
    } catch (err) {
      assertEqual(err.constructor.name, 'NotFoundError');
    }
  });

  // --- remove ---
  await test('remove: removes an existing bookmark', async () => {
    mockQueryOneResults = [{ id: 'bm-1' }]; // delete returns row

    const result = await BookmarkService.remove('agent-1', 'post-1');
    assertEqual(result.action, 'removed');
    assert(calls[0].text.includes('DELETE FROM bookmarks'), 'should delete');
  });

  await test('remove: returns not_bookmarked if not found', async () => {
    mockQueryOneResults = [null]; // delete returns nothing

    const result = await BookmarkService.remove('agent-1', 'post-1');
    assertEqual(result.action, 'not_bookmarked');
  });

  // --- list ---
  await test('list: returns bookmarked posts with metadata', async () => {
    const mockPosts = [
      {
        id: 'post-1',
        title: 'Test Post',
        content: 'Hello world',
        submolt: 'general',
        author_name: 'other_agent',
        bookmarked_at: '2026-06-24T10:00:00Z',
        reaction_counts: {},
        bookmark_count: 3
      }
    ];
    mockQueryAllResults = [mockPosts];

    const result = await BookmarkService.list('agent-1', { limit: 25, offset: 0 });
    assertEqual(result.length, 1);
    assertEqual(result[0].title, 'Test Post');
    assertEqual(result[0].bookmark_count, 3);
    assert(calls[0].text.includes('FROM bookmarks b'), 'should query from bookmarks');
    assert(calls[0].text.includes('JOIN posts p'), 'should join posts');
    assert(calls[0].params[0] === 'agent-1', 'should filter by agent');
  });

  await test('list: returns empty array when no bookmarks', async () => {
    mockQueryAllResults = [[]];

    const result = await BookmarkService.list('agent-1');
    assertEqual(result.length, 0);
  });

  await test('list: passes pagination params correctly', async () => {
    mockQueryAllResults = [[]];

    await BookmarkService.list('agent-1', { limit: 10, offset: 5 });
    assertEqual(calls[0].params[1], 10, 'limit should be 10');
    assertEqual(calls[0].params[2], 5, 'offset should be 5');
  });

  // --- isBookmarked ---
  await test('isBookmarked: returns true when bookmarked', async () => {
    mockQueryOneResults = [{ id: 'bm-1' }];

    const result = await BookmarkService.isBookmarked('agent-1', 'post-1');
    assertEqual(result, true);
  });

  await test('isBookmarked: returns false when not bookmarked', async () => {
    mockQueryOneResults = [null];

    const result = await BookmarkService.isBookmarked('agent-1', 'post-1');
    assertEqual(result, false);
  });

  // --- getCount ---
  await test('getCount: returns bookmark count for a post', async () => {
    mockQueryOneResults = [{ count: 7 }];

    const result = await BookmarkService.getCount('post-1');
    assertEqual(result, 7);
    assert(calls[0].params[0] === 'post-1', 'should filter by post_id');
  });

  await test('getCount: returns 0 when no bookmarks', async () => {
    mockQueryOneResults = [{ count: 0 }];

    const result = await BookmarkService.getCount('post-1');
    assertEqual(result, 0);
  });

  await test('getCount: returns 0 when query returns null', async () => {
    mockQueryOneResults = [null];

    const result = await BookmarkService.getCount('post-1');
    assertEqual(result, 0);
  });

  // Summary
  console.log(`\n${passed + failed} tests, ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})();
