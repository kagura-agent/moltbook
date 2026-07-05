/**
 * Post Pinning Test Suite
 *
 * Run: node test/pinning.test.js
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
    },
    transaction: async (cb) => cb({ query: async () => ({ rows: [] }) })
  }
};

const PostService = require('../src/services/PostService');

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
}

async function runTests() {
  console.log('\nPost Pinning Test Suite\n');
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

// ── pinPost ─────────────────────────────────────────────────────────────────

describe('pinPost', () => {
  test('pins a post as submolt owner', async () => {
    mockQueryOneResults.push(
      { id: 'submolt-1' },                              // submolt lookup
      { role: 'owner' },                                 // mod check
      { id: 'post-1', submolt_id: 'submolt-1', is_pinned: false }, // post lookup
    );
    mockQueryAllResults.push([]);                         // pinned count (0)
    mockQueryOneResults.push(
      { id: 'post-1', title: 'Test', submolt: 'tech', is_pinned: true, pinned_at: '2026-07-04T00:00:00Z' }
    );

    const result = await PostService.pinPost('post-1', 'tech', 'agent-1');
    assertEqual(result.is_pinned, true);
    assert(result.pinned_at !== null, 'pinned_at should be set');
  });

  test('pins a post as submolt moderator', async () => {
    mockQueryOneResults.push(
      { id: 'submolt-1' },
      { role: 'moderator' },
      { id: 'post-1', submolt_id: 'submolt-1', is_pinned: false },
    );
    mockQueryAllResults.push([]);
    mockQueryOneResults.push(
      { id: 'post-1', title: 'Test', submolt: 'tech', is_pinned: true, pinned_at: '2026-07-04T00:00:00Z' }
    );

    const result = await PostService.pinPost('post-1', 'tech', 'agent-1');
    assertEqual(result.is_pinned, true);
  });

  test('rejects pin from non-moderator (403)', async () => {
    mockQueryOneResults.push(
      { id: 'submolt-1' },
      null                                                // not a mod
    );

    try {
      await PostService.pinPost('post-1', 'tech', 'agent-1');
      assert(false, 'Should have thrown');
    } catch (err) {
      assert(err.statusCode === 403, `Expected 403, got ${err.statusCode}`);
    }
  });

  test('rejects pin when submolt not found (404)', async () => {
    mockQueryOneResults.push(null);                        // submolt not found

    try {
      await PostService.pinPost('post-1', 'nosub', 'agent-1');
      assert(false, 'Should have thrown');
    } catch (err) {
      assert(err.statusCode === 404, `Expected 404, got ${err.statusCode}`);
    }
  });

  test('rejects pin for post from wrong submolt (404)', async () => {
    mockQueryOneResults.push(
      { id: 'submolt-1' },
      { role: 'owner' },
      { id: 'post-1', submolt_id: 'submolt-OTHER', is_pinned: false }
    );

    try {
      await PostService.pinPost('post-1', 'tech', 'agent-1');
      assert(false, 'Should have thrown');
    } catch (err) {
      assert(err.statusCode === 404, `Expected 404, got ${err.statusCode}`);
    }
  });

  test('rejects pin for nonexistent post (404)', async () => {
    mockQueryOneResults.push(
      { id: 'submolt-1' },
      { role: 'owner' },
      null                                                 // post not found
    );

    try {
      await PostService.pinPost('bad-id', 'tech', 'agent-1');
      assert(false, 'Should have thrown');
    } catch (err) {
      assert(err.statusCode === 404, `Expected 404, got ${err.statusCode}`);
    }
  });

  test('rejects pin when already pinned (400)', async () => {
    mockQueryOneResults.push(
      { id: 'submolt-1' },
      { role: 'owner' },
      { id: 'post-1', submolt_id: 'submolt-1', is_pinned: true }
    );

    try {
      await PostService.pinPost('post-1', 'tech', 'agent-1');
      assert(false, 'Should have thrown');
    } catch (err) {
      assert(err.statusCode === 400, `Expected 400, got ${err.statusCode}`);
      assert(err.code === 'ALREADY_PINNED', `Expected ALREADY_PINNED, got ${err.code}`);
    }
  });

  test('rejects pin when 3 already pinned (400)', async () => {
    mockQueryOneResults.push(
      { id: 'submolt-1' },
      { role: 'owner' },
      { id: 'post-4', submolt_id: 'submolt-1', is_pinned: false },
    );
    mockQueryAllResults.push([{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }]); // 3 pinned

    try {
      await PostService.pinPost('post-4', 'tech', 'agent-1');
      assert(false, 'Should have thrown');
    } catch (err) {
      assert(err.statusCode === 400, `Expected 400, got ${err.statusCode}`);
      assert(err.code === 'PIN_LIMIT', `Expected PIN_LIMIT, got ${err.code}`);
    }
  });
});

// ── unpinPost ───────────────────────────────────────────────────────────────

describe('unpinPost', () => {
  test('unpins a post as owner', async () => {
    mockQueryOneResults.push(
      { id: 'submolt-1' },
      { role: 'owner' },
      { id: 'post-1', submolt_id: 'submolt-1', is_pinned: true },
      { id: 'post-1', title: 'Test', submolt: 'tech', is_pinned: false, pinned_at: null }
    );

    const result = await PostService.unpinPost('post-1', 'tech', 'agent-1');
    assertEqual(result.is_pinned, false);
    assertEqual(result.pinned_at, null);
  });

  test('rejects unpin from non-moderator (403)', async () => {
    mockQueryOneResults.push(
      { id: 'submolt-1' },
      null
    );

    try {
      await PostService.unpinPost('post-1', 'tech', 'agent-1');
      assert(false, 'Should have thrown');
    } catch (err) {
      assert(err.statusCode === 403, `Expected 403, got ${err.statusCode}`);
    }
  });

  test('rejects unpin when post is not pinned (400)', async () => {
    mockQueryOneResults.push(
      { id: 'submolt-1' },
      { role: 'owner' },
      { id: 'post-1', submolt_id: 'submolt-1', is_pinned: false }
    );

    try {
      await PostService.unpinPost('post-1', 'tech', 'agent-1');
      assert(false, 'Should have thrown');
    } catch (err) {
      assert(err.statusCode === 400, `Expected 400, got ${err.statusCode}`);
      assert(err.code === 'NOT_PINNED', `Expected NOT_PINNED, got ${err.code}`);
    }
  });
});

// ── Feed ordering ───────────────────────────────────────────────────────────

describe('feed ordering', () => {
  test('pinned posts appear first in submolt feed', async () => {
    mockQueryAllResults.push([
      { id: 'pinned-1', title: 'Pinned', is_pinned: true, pinned_at: '2026-07-04T00:00:00Z',
        author_name: 'a', author_display_name: 'A', reaction_counts: '{}', bookmark_count: 0 },
      { id: 'regular-1', title: 'Regular', is_pinned: false, pinned_at: null,
        author_name: 'b', author_display_name: 'B', reaction_counts: '{}', bookmark_count: 0 },
    ]);

    const result = await PostService.getBySubmolt('tech', { sort: 'new', limit: 25, offset: 0 });
    assertEqual(result[0].id, 'pinned-1');
    assertEqual(result[0].is_pinned, true);
    assertEqual(result[1].id, 'regular-1');

    const feedQuery = calls.find(c => c.fn === 'queryAll');
    assert(feedQuery.text.includes('is_pinned DESC'), 'Query should order by is_pinned DESC');
    assert(feedQuery.text.includes('pinned_at DESC'), 'Query should order by pinned_at DESC');
  });

  test('is_pinned field is included in feed response', async () => {
    mockQueryAllResults.push([
      { id: 'post-1', title: 'Test', is_pinned: false, pinned_at: null,
        author_name: 'a', author_display_name: 'A', reaction_counts: '{}', bookmark_count: 0 },
    ]);

    const result = await PostService.getBySubmolt('tech', { sort: 'new', limit: 25, offset: 0 });
    assert('is_pinned' in result[0], 'Response should include is_pinned');
    assert('pinned_at' in result[0], 'Response should include pinned_at');
  });
});

runTests();
