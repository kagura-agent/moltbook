/**
 * Polls Test Suite
 *
 * Run: node test/polls.test.js
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

const PollService = require('../src/services/PollService');

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
  console.log('\nPolls Test Suite\n');
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

describe('create', () => {
  test('creates poll with options', async () => {
    mockQueryOneResults.push(
      { id: 'post-1' },                                         // post exists
      null,                                                      // no existing poll
      { id: 'poll-1', post_id: 'post-1', expires_at: null, created_at: '2026-07-04T00:00:00Z' }, // insert poll
      { id: 'opt-1', text: 'Yes', position: 0, vote_count: 0 }, // insert option 1
      { id: 'opt-2', text: 'No', position: 1, vote_count: 0 }   // insert option 2
    );

    const result = await PollService.create({ postId: 'post-1', options: ['Yes', 'No'] });
    assertEqual(result.id, 'poll-1');
    assertEqual(result.post_id, 'post-1');
    assertEqual(result.options.length, 2);
    assertEqual(result.options[0].text, 'Yes');
    assertEqual(result.options[1].text, 'No');
  });

  test('creates poll with 6 options', async () => {
    const opts = ['A', 'B', 'C', 'D', 'E', 'F'];
    mockQueryOneResults.push(
      { id: 'post-1' },
      null,
      { id: 'poll-1', post_id: 'post-1', expires_at: null, created_at: '2026-07-04T00:00:00Z' }
    );
    for (let i = 0; i < 6; i++) {
      mockQueryOneResults.push({ id: `opt-${i}`, text: opts[i], position: i, vote_count: 0 });
    }

    const result = await PollService.create({ postId: 'post-1', options: opts });
    assertEqual(result.options.length, 6);
  });

  test('creates poll with expiry', async () => {
    const exp = '2026-12-31T23:59:59Z';
    mockQueryOneResults.push(
      { id: 'post-1' },
      null,
      { id: 'poll-1', post_id: 'post-1', expires_at: exp, created_at: '2026-07-04T00:00:00Z' },
      { id: 'opt-1', text: 'A', position: 0, vote_count: 0 },
      { id: 'opt-2', text: 'B', position: 1, vote_count: 0 }
    );

    const result = await PollService.create({ postId: 'post-1', options: ['A', 'B'], expiresAt: exp });
    assertEqual(result.expires_at, exp);
  });

  test('rejects fewer than 2 options', async () => {
    try {
      await PollService.create({ postId: 'post-1', options: ['Only one'] });
      assert(false, 'Should have thrown');
    } catch (err) {
      assert(err.statusCode === 400, `Expected 400, got ${err.statusCode}`);
      assert(err.message.includes('2-6'), `Got: ${err.message}`);
    }
  });

  test('rejects more than 6 options', async () => {
    try {
      await PollService.create({ postId: 'post-1', options: ['A', 'B', 'C', 'D', 'E', 'F', 'G'] });
      assert(false, 'Should have thrown');
    } catch (err) {
      assert(err.statusCode === 400, `Expected 400, got ${err.statusCode}`);
    }
  });

  test('rejects non-array options', async () => {
    try {
      await PollService.create({ postId: 'post-1', options: 'not-an-array' });
      assert(false, 'Should have thrown');
    } catch (err) {
      assert(err.statusCode === 400, `Expected 400, got ${err.statusCode}`);
    }
  });

  test('rejects when post does not exist', async () => {
    mockQueryOneResults.push(null); // post not found

    try {
      await PollService.create({ postId: 'bad-id', options: ['A', 'B'] });
      assert(false, 'Should have thrown');
    } catch (err) {
      assert(err.statusCode === 404, `Expected 404, got ${err.statusCode}`);
    }
  });

  test('rejects duplicate poll on same post', async () => {
    mockQueryOneResults.push(
      { id: 'post-1' },    // post exists
      { id: 'poll-1' }     // poll already exists
    );

    try {
      await PollService.create({ postId: 'post-1', options: ['A', 'B'] });
      assert(false, 'Should have thrown');
    } catch (err) {
      assert(err.statusCode === 409, `Expected 409, got ${err.statusCode}`);
      assert(err.message.includes('already has a poll'), `Got: ${err.message}`);
    }
  });
});

describe('vote', () => {
  test('records a vote', async () => {
    mockQueryOneResults.push(
      { id: 'poll-1', expires_at: null },                          // poll exists
      { id: 'opt-1', poll_id: 'poll-1' },                         // option exists
      null,                                                         // no existing vote
      { id: 'vote-1', poll_id: 'poll-1', option_id: 'opt-1', agent_id: 'agent-1', created_at: '2026-07-04T00:00:00Z' }, // insert vote
      null                                                          // update count
    );

    const result = await PollService.vote('poll-1', 'opt-1', 'agent-1');
    assertEqual(result.poll_id, 'poll-1');
    assertEqual(result.option_id, 'opt-1');
    assertEqual(result.agent_id, 'agent-1');
    // Verify vote count was incremented
    const updateCall = calls.find(c => c.text.includes('UPDATE poll_options'));
    assert(updateCall, 'Should have updated vote count');
  });

  test('rejects when poll not found', async () => {
    mockQueryOneResults.push(null); // poll not found

    try {
      await PollService.vote('bad-id', 'opt-1', 'agent-1');
      assert(false, 'Should have thrown');
    } catch (err) {
      assert(err.statusCode === 404, `Expected 404, got ${err.statusCode}`);
    }
  });

  test('rejects vote on expired poll', async () => {
    mockQueryOneResults.push({ id: 'poll-1', expires_at: '2020-01-01T00:00:00Z' }); // expired

    try {
      await PollService.vote('poll-1', 'opt-1', 'agent-1');
      assert(false, 'Should have thrown');
    } catch (err) {
      assert(err.statusCode === 400, `Expected 400, got ${err.statusCode}`);
      assert(err.code === 'POLL_EXPIRED', `Expected POLL_EXPIRED, got ${err.code}`);
    }
  });

  test('rejects option from different poll', async () => {
    mockQueryOneResults.push(
      { id: 'poll-1', expires_at: null },        // poll exists
      { id: 'opt-1', poll_id: 'other-poll' }     // option belongs to different poll
    );

    try {
      await PollService.vote('poll-1', 'opt-1', 'agent-1');
      assert(false, 'Should have thrown');
    } catch (err) {
      assert(err.statusCode === 400, `Expected 400, got ${err.statusCode}`);
      assert(err.code === 'INVALID_OPTION', `Expected INVALID_OPTION, got ${err.code}`);
    }
  });

  test('rejects duplicate vote', async () => {
    mockQueryOneResults.push(
      { id: 'poll-1', expires_at: null },         // poll exists
      { id: 'opt-1', poll_id: 'poll-1' },         // option valid
      { id: 'existing-vote' }                      // already voted
    );

    try {
      await PollService.vote('poll-1', 'opt-1', 'agent-1');
      assert(false, 'Should have thrown');
    } catch (err) {
      assert(err.statusCode === 409, `Expected 409, got ${err.statusCode}`);
      assert(err.message.includes('Already voted'), `Got: ${err.message}`);
    }
  });
});

describe('findById', () => {
  test('returns poll with options and totals', async () => {
    mockQueryOneResults.push(
      { id: 'poll-1', post_id: 'post-1', expires_at: null, created_at: '2026-07-04T00:00:00Z' }
    );
    mockQueryAllResults.push([
      { id: 'opt-1', text: 'Yes', position: 0, vote_count: 7 },
      { id: 'opt-2', text: 'No', position: 1, vote_count: 3 }
    ]);

    const result = await PollService.findById('poll-1');
    assertEqual(result.id, 'poll-1');
    assertEqual(result.total_votes, 10);
    assertEqual(result.options[0].votes, 7);
    assertEqual(result.options[0].percentage, 70);
    assertEqual(result.options[1].votes, 3);
    assertEqual(result.options[1].percentage, 30);
    assertEqual(result.user_vote, null);
    assertEqual(result.expired, false);
  });

  test('includes user vote when authenticated', async () => {
    mockQueryOneResults.push(
      { id: 'poll-1', post_id: 'post-1', expires_at: null, created_at: '2026-07-04T00:00:00Z' },
      { option_id: 'opt-2' }  // user voted for opt-2
    );
    mockQueryAllResults.push([
      { id: 'opt-1', text: 'Yes', position: 0, vote_count: 5 },
      { id: 'opt-2', text: 'No', position: 1, vote_count: 3 }
    ]);

    const result = await PollService.findById('poll-1', 'agent-1');
    assertEqual(result.user_vote, 'opt-2');
  });

  test('reports expired poll', async () => {
    mockQueryOneResults.push(
      { id: 'poll-1', post_id: 'post-1', expires_at: '2020-01-01T00:00:00Z', created_at: '2019-12-01T00:00:00Z' }
    );
    mockQueryAllResults.push([]);

    const result = await PollService.findById('poll-1');
    assertEqual(result.expired, true);
  });

  test('handles zero votes with 0% percentages', async () => {
    mockQueryOneResults.push(
      { id: 'poll-1', post_id: 'post-1', expires_at: null, created_at: '2026-07-04T00:00:00Z' }
    );
    mockQueryAllResults.push([
      { id: 'opt-1', text: 'A', position: 0, vote_count: 0 },
      { id: 'opt-2', text: 'B', position: 1, vote_count: 0 }
    ]);

    const result = await PollService.findById('poll-1');
    assertEqual(result.total_votes, 0);
    assertEqual(result.options[0].percentage, 0);
    assertEqual(result.options[1].percentage, 0);
  });

  test('throws NotFoundError for missing poll', async () => {
    try {
      await PollService.findById('bad-id');
      assert(false, 'Should have thrown');
    } catch (err) {
      assert(err.statusCode === 404, `Expected 404, got ${err.statusCode}`);
    }
  });
});

describe('findByPostId', () => {
  test('returns null when post has no poll', async () => {
    // queryOne returns null by default
    const result = await PollService.findByPostId('post-1');
    assertEqual(result, null);
  });

  test('returns poll when post has one', async () => {
    mockQueryOneResults.push(
      { id: 'poll-1' },  // findByPostId lookup
      { id: 'poll-1', post_id: 'post-1', expires_at: null, created_at: '2026-07-04T00:00:00Z' }  // findById
    );
    mockQueryAllResults.push([
      { id: 'opt-1', text: 'A', position: 0, vote_count: 0 }
    ]);

    const result = await PollService.findByPostId('post-1');
    assertEqual(result.id, 'poll-1');
  });
});

// Run
runTests();
