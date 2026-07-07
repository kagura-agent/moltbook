/**
 * Post Views Test Suite
 *
 * Run: node test/post-views.test.js
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

const PostViewService = require('../src/services/PostViewService');

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
  console.log('PostViewService tests:\n');

  // --- recordView ---
  await test('recordView: records a new view and updates count', async () => {
    mockQueryOneResults = [
      { id: 'post-1' },   // post exists check
      { id: 'view-1' },   // INSERT ON CONFLICT result
      { id: 'post-1' }    // UPDATE view_count result
    ];

    await PostViewService.recordView('post-1', 'agent-1');
    assertEqual(calls.length, 3);
    assert(calls[0].text.includes('SELECT id FROM posts'), 'should check post exists');
    assert(calls[1].text.includes('INSERT INTO post_views'), 'should insert view');
    assert(calls[1].text.includes('ON CONFLICT'), 'should use ON CONFLICT');
    assert(calls[1].params[0] === 'post-1', 'should pass post_id');
    assert(calls[1].params[1] === 'agent-1', 'should pass agent_id');
    assert(calls[2].text.includes('UPDATE posts SET view_count'), 'should update denormalized count');
  });

  await test('recordView: duplicate view does not error (ON CONFLICT DO NOTHING)', async () => {
    mockQueryOneResults = [
      { id: 'post-1' },   // post exists
      null,                // INSERT returns null (conflict, no row inserted)
      { id: 'post-1' }    // UPDATE view_count still runs
    ];

    await PostViewService.recordView('post-1', 'agent-1');
    assertEqual(calls.length, 3);
    assert(calls[1].text.includes('ON CONFLICT'), 'should use ON CONFLICT DO NOTHING');
    assert(calls[2].text.includes('UPDATE posts SET view_count'), 'should still sync count');
  });

  await test('recordView: throws NotFoundError if post does not exist', async () => {
    mockQueryOneResults = [null]; // post not found

    try {
      await PostViewService.recordView('nonexistent', 'agent-1');
      throw new Error('Should have thrown');
    } catch (err) {
      assertEqual(err.constructor.name, 'NotFoundError');
    }
  });

  await test('recordView: count update uses subquery from post_views', async () => {
    mockQueryOneResults = [
      { id: 'post-1' },
      { id: 'view-1' },
      { id: 'post-1' }
    ];

    await PostViewService.recordView('post-1', 'agent-1');
    assert(calls[2].text.includes('SELECT COUNT(*)'), 'should count from post_views');
    assert(calls[2].text.includes('FROM post_views'), 'should reference post_views table');
  });

  // --- getViewCount ---
  await test('getViewCount: returns count for a post', async () => {
    mockQueryOneResults = [{ count: 42 }];

    const result = await PostViewService.getViewCount('post-1');
    assertEqual(result, 42);
    assert(calls[0].params[0] === 'post-1', 'should filter by post_id');
    assert(calls[0].text.includes('COUNT(*)'), 'should count views');
  });

  await test('getViewCount: returns 0 when no views', async () => {
    mockQueryOneResults = [{ count: 0 }];

    const result = await PostViewService.getViewCount('post-1');
    assertEqual(result, 0);
  });

  await test('getViewCount: returns 0 when query returns null', async () => {
    mockQueryOneResults = [null];

    const result = await PostViewService.getViewCount('post-1');
    assertEqual(result, 0);
  });

  // --- getRecentViewers ---
  await test('getRecentViewers: returns viewer names and timestamps', async () => {
    const mockViewers = [
      { name: 'agent_alpha', display_name: 'Alpha', viewed_at: '2026-07-01T10:00:00Z' },
      { name: 'agent_beta', display_name: 'Beta', viewed_at: '2026-07-01T09:00:00Z' }
    ];
    mockQueryAllResults = [mockViewers];

    const result = await PostViewService.getRecentViewers('post-1');
    assertEqual(result.length, 2);
    assertEqual(result[0].name, 'agent_alpha');
    assertEqual(result[1].name, 'agent_beta');
    assert(calls[0].text.includes('FROM post_views pv'), 'should query post_views');
    assert(calls[0].text.includes('JOIN agents a'), 'should join agents');
    assert(calls[0].text.includes('ORDER BY pv.viewed_at DESC'), 'should order by recency');
  });

  await test('getRecentViewers: returns empty array when no viewers', async () => {
    mockQueryAllResults = [[]];

    const result = await PostViewService.getRecentViewers('post-1');
    assertEqual(result.length, 0);
  });

  await test('getRecentViewers: respects custom limit', async () => {
    mockQueryAllResults = [[]];

    await PostViewService.getRecentViewers('post-1', 5);
    assertEqual(calls[0].params[1], 5, 'should pass custom limit');
  });

  await test('getRecentViewers: defaults limit to 10', async () => {
    mockQueryAllResults = [[]];

    await PostViewService.getRecentViewers('post-1');
    assertEqual(calls[0].params[1], 10, 'should default limit to 10');
  });

  // Summary
  console.log(`\n${passed + failed} tests, ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})();
