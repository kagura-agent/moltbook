/**
 * Reactions Test Suite
 *
 * Run: node test/reactions.test.js
 */

// Mock database before requiring service
const calls = [];
let mockQueryOneResults = [];
let mockQueryAllResults = [];

// Special sentinel for throwing errors from the queue
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

const ReactionService = require('../src/services/ReactionService');
const { ALLOWED_REACTIONS } = require('../src/services/ReactionService');

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
}

async function runTests() {
  console.log('\nReactions Test Suite\n');
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

describe('ALLOWED_REACTIONS', () => {
  test('contains expected reaction types', () => {
    assertEqual(ALLOWED_REACTIONS, ['thumbs_up', 'heart', 'celebration', 'thinking', 'eyes', 'rocket']);
  });
});

describe('addReaction', () => {
  test('adds a valid reaction', async () => {
    // Mock: post exists (queryOne #1), then insert succeeds (queryOne #2)
    mockQueryOneResults.push({ id: 'post-1' });
    mockQueryOneResults.push({ id: 'r-1', post_id: 'post-1', agent_id: 'agent-1', reaction_type: 'heart', created_at: '2026-01-01' });

    const result = await ReactionService.addReaction('post-1', 'agent-1', 'heart');
    assertEqual(result.reaction_type, 'heart');
    assertEqual(result.post_id, 'post-1');
  });

  test('rejects invalid reaction type', async () => {
    try {
      await ReactionService.addReaction('post-1', 'agent-1', 'invalid_type');
      assert(false, 'Should have thrown');
    } catch (err) {
      assert(err.message.includes('Invalid reaction type'), `Got: ${err.message}`);
      assert(err.statusCode === 400, `Expected 400, got ${err.statusCode}`);
    }
  });

  test('rejects when post does not exist', async () => {
    // Mock: post lookup returns null
    mockQueryOneResults.push(null);

    try {
      await ReactionService.addReaction('bad-id', 'agent-1', 'heart');
      assert(false, 'Should have thrown');
    } catch (err) {
      assert(err.statusCode === 404, `Expected 404, got ${err.statusCode}`);
    }
  });

  test('rejects duplicate reaction with ConflictError', async () => {
    // Mock: post exists, then insert throws unique violation
    mockQueryOneResults.push({ id: 'post-1' });
    const dupErr = new Error('duplicate key');
    dupErr.code = '23505';
    mockQueryOneResults.push(new MockError(dupErr));

    try {
      await ReactionService.addReaction('post-1', 'agent-1', 'heart');
      assert(false, 'Should have thrown');
    } catch (err) {
      assert(err.statusCode === 409, `Expected 409, got ${err.statusCode}`);
    }
  });
});

describe('removeReaction', () => {
  test('removes an existing reaction', async () => {
    mockQueryOneResults.push({ id: 'r-1' });

    await ReactionService.removeReaction('post-1', 'agent-1', 'heart');
    assert(calls[0].text.includes('DELETE FROM reactions'));
  });

  test('throws NotFoundError when reaction does not exist', async () => {
    // queryOne returns null (no row deleted)
    try {
      await ReactionService.removeReaction('post-1', 'agent-1', 'heart');
      assert(false, 'Should have thrown');
    } catch (err) {
      assert(err.statusCode === 404, `Expected 404, got ${err.statusCode}`);
    }
  });
});

describe('getReactionsByPost', () => {
  test('returns aggregated counts', async () => {
    mockQueryAllResults.push([
      { reaction_type: 'heart', count: 5 },
      { reaction_type: 'rocket', count: 2 }
    ]);

    const counts = await ReactionService.getReactionsByPost('post-1');
    assertEqual(counts, { heart: 5, rocket: 2 });
  });

  test('returns empty object when no reactions', async () => {
    // queryAll returns empty array by default
    const counts = await ReactionService.getReactionsByPost('post-1');
    assertEqual(counts, {});
  });
});

describe('getReactionsByAgent', () => {
  test('returns agent reaction types on a post', async () => {
    mockQueryAllResults.push([
      { reaction_type: 'heart' },
      { reaction_type: 'rocket' }
    ]);

    const types = await ReactionService.getReactionsByAgent('agent-1', 'post-1');
    assertEqual(types, ['heart', 'rocket']);
  });

  test('returns empty array when agent has no reactions', async () => {
    const types = await ReactionService.getReactionsByAgent('agent-1', 'post-1');
    assertEqual(types, []);
  });
});

describe('getReactionsForPosts', () => {
  test('returns grouped reactions for multiple posts', async () => {
    mockQueryAllResults.push([
      { post_id: 'p1', reaction_type: 'heart', count: 3 },
      { post_id: 'p1', reaction_type: 'rocket', count: 1 },
      { post_id: 'p2', reaction_type: 'thumbs_up', count: 5 }
    ]);

    const result = await ReactionService.getReactionsForPosts(['p1', 'p2']);
    assertEqual(result, { p1: { heart: 3, rocket: 1 }, p2: { thumbs_up: 5 } });
  });

  test('returns empty object for empty input', async () => {
    const result = await ReactionService.getReactionsForPosts([]);
    assertEqual(result, {});
    assert(calls.length === 0, 'Should not query DB for empty input');
  });
});

// Run
runTests();
