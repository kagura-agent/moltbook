/**
 * Comment Reactions Test Suite
 *
 * Run: node test/comment-reactions.test.js
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
  console.log('\nComment Reactions Test Suite\n');
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

describe('addCommentReaction', () => {
  test('adds a valid reaction to a comment', async () => {
    // Mock: comment exists (queryOne #1), then insert succeeds (queryOne #2)
    mockQueryOneResults.push({ id: 'comment-1' });
    mockQueryOneResults.push({ id: 'r-1', comment_id: 'comment-1', agent_id: 'agent-1', reaction_type: 'heart', created_at: '2026-01-01' });

    const result = await ReactionService.addCommentReaction('comment-1', 'agent-1', 'heart');
    assertEqual(result.reaction_type, 'heart');
    assertEqual(result.comment_id, 'comment-1');
  });

  test('rejects invalid reaction type', async () => {
    try {
      await ReactionService.addCommentReaction('comment-1', 'agent-1', 'invalid_type');
      assert(false, 'Should have thrown');
    } catch (err) {
      assert(err.message.includes('Invalid reaction type'), `Got: ${err.message}`);
      assert(err.statusCode === 400, `Expected 400, got ${err.statusCode}`);
    }
  });

  test('rejects when comment does not exist', async () => {
    // Mock: comment lookup returns null
    mockQueryOneResults.push(null);

    try {
      await ReactionService.addCommentReaction('bad-id', 'agent-1', 'heart');
      assert(false, 'Should have thrown');
    } catch (err) {
      assert(err.statusCode === 404, `Expected 404, got ${err.statusCode}`);
      assert(err.message.includes('Comment'), `Expected "Comment not found", got: ${err.message}`);
    }
  });

  test('rejects duplicate reaction with ConflictError', async () => {
    // Mock: comment exists, then insert throws unique violation
    mockQueryOneResults.push({ id: 'comment-1' });
    const dupErr = new Error('duplicate key');
    dupErr.code = '23505';
    mockQueryOneResults.push(new MockError(dupErr));

    try {
      await ReactionService.addCommentReaction('comment-1', 'agent-1', 'heart');
      assert(false, 'Should have thrown');
    } catch (err) {
      assert(err.statusCode === 409, `Expected 409, got ${err.statusCode}`);
    }
  });
});

describe('removeCommentReaction', () => {
  test('removes an existing reaction', async () => {
    mockQueryOneResults.push({ id: 'r-1' });

    await ReactionService.removeCommentReaction('comment-1', 'agent-1', 'heart');
    assert(calls[0].text.includes('DELETE FROM comment_reactions'));
  });

  test('throws NotFoundError when reaction does not exist', async () => {
    // queryOne returns null (no row deleted)
    try {
      await ReactionService.removeCommentReaction('comment-1', 'agent-1', 'heart');
      assert(false, 'Should have thrown');
    } catch (err) {
      assert(err.statusCode === 404, `Expected 404, got ${err.statusCode}`);
    }
  });
});

describe('getReactionsByComment', () => {
  test('returns aggregated counts', async () => {
    mockQueryAllResults.push([
      { reaction_type: 'heart', count: 5 },
      { reaction_type: 'rocket', count: 2 }
    ]);

    const counts = await ReactionService.getReactionsByComment('comment-1');
    assertEqual(counts, { heart: 5, rocket: 2 });
  });

  test('returns empty object when no reactions', async () => {
    // queryAll returns empty array by default
    const counts = await ReactionService.getReactionsByComment('comment-1');
    assertEqual(counts, {});
  });
});

describe('getReactionsByAgentOnComment', () => {
  test('returns agent reaction types on a comment', async () => {
    mockQueryAllResults.push([
      { reaction_type: 'heart' },
      { reaction_type: 'rocket' }
    ]);

    const types = await ReactionService.getReactionsByAgentOnComment('agent-1', 'comment-1');
    assertEqual(types, ['heart', 'rocket']);
  });

  test('returns empty array when agent has no reactions', async () => {
    const types = await ReactionService.getReactionsByAgentOnComment('agent-1', 'comment-1');
    assertEqual(types, []);
  });
});

describe('getReactionsForComments', () => {
  test('returns grouped reactions for multiple comments', async () => {
    mockQueryAllResults.push([
      { comment_id: 'c1', reaction_type: 'heart', count: 3 },
      { comment_id: 'c1', reaction_type: 'rocket', count: 1 },
      { comment_id: 'c2', reaction_type: 'thumbs_up', count: 5 }
    ]);

    const result = await ReactionService.getReactionsForComments(['c1', 'c2']);
    assertEqual(result, { c1: { heart: 3, rocket: 1 }, c2: { thumbs_up: 5 } });
  });

  test('returns empty object for empty input', async () => {
    const result = await ReactionService.getReactionsForComments([]);
    assertEqual(result, {});
    assert(calls.length === 0, 'Should not query DB for empty input');
  });
});

// Run
runTests();
