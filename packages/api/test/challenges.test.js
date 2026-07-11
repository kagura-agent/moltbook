/**
 * Challenges Test Suite
 *
 * Run: node test/challenges.test.js
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

const ChallengeService = require('../src/services/ChallengeService');

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
  if (actual !== expected) {
    throw new Error(message || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertRejects(fn, errorType, message) {
  return fn().then(() => {
    throw new Error(message || `Expected ${errorType} to be thrown`);
  }).catch(err => {
    if (err.message === (message || `Expected ${errorType} to be thrown`)) throw err;
    // Error was thrown as expected
  });
}

function resetMocks() {
  calls.length = 0;
  mockQueryOneResults.length = 0;
  mockQueryAllResults.length = 0;
}

// ====== TESTS ======

describe('ChallengeService.create', () => {
  test('should reject empty title', async () => {
    resetMocks();
    await assertRejects(
      () => ChallengeService.create({ title: '', endsAt: '2026-12-31' }),
      'BadRequestError'
    );
  });

  test('should reject missing title', async () => {
    resetMocks();
    await assertRejects(
      () => ChallengeService.create({ endsAt: '2026-12-31' }),
      'BadRequestError'
    );
  });

  test('should reject title over 200 chars', async () => {
    resetMocks();
    await assertRejects(
      () => ChallengeService.create({ title: 'x'.repeat(201), endsAt: '2026-12-31' }),
      'BadRequestError'
    );
  });

  test('should reject missing ends_at', async () => {
    resetMocks();
    await assertRejects(
      () => ChallengeService.create({ title: 'Test Challenge' }),
      'BadRequestError'
    );
  });

  test('should reject ends_at before starts_at', async () => {
    resetMocks();
    await assertRejects(
      () => ChallengeService.create({
        title: 'Test Challenge',
        startsAt: '2026-12-31',
        endsAt: '2026-12-01'
      }),
      'BadRequestError'
    );
  });

  test('should create challenge successfully', async () => {
    resetMocks();
    const mockChallenge = {
      id: 'challenge-1',
      title: 'Week 28: Debugging stories',
      description: null,
      submolt: 'general',
      flair_id: null,
      starts_at: '2026-07-11T00:00:00.000Z',
      ends_at: '2026-07-18T00:00:00.000Z',
      status: 'active',
      created_by: 'kagura',
      created_at: '2026-07-11T00:00:00.000Z'
    };
    mockQueryOneResults.push(mockChallenge);

    const result = await ChallengeService.create({
      title: 'Week 28: Debugging stories',
      endsAt: '2026-07-18T00:00:00.000Z',
      createdBy: 'kagura'
    });

    assertEqual(result.id, 'challenge-1');
    assertEqual(result.title, 'Week 28: Debugging stories');
    assert(calls.length === 1, 'Should have 1 DB call');
    assert(calls[0].text.includes('INSERT INTO writing_challenges'), 'Should INSERT');
  });
});

describe('ChallengeService.getActive', () => {
  test('should return active challenges', async () => {
    resetMocks();
    mockQueryAllResults.push([
      { id: 'c1', title: 'Active Challenge', status: 'active', entry_count: 3 }
    ]);

    const result = await ChallengeService.getActive();
    assertEqual(result.length, 1);
    assertEqual(result[0].entry_count, 3);
    assert(calls[0].text.includes("status = 'active'"), 'Should filter active');
    assert(calls[0].text.includes('NOW() >= wc.starts_at'), 'Should check date range');
  });

  test('should return empty array when no active challenges', async () => {
    resetMocks();
    mockQueryAllResults.push([]);

    const result = await ChallengeService.getActive();
    assertEqual(result.length, 0);
  });
});

describe('ChallengeService.getById', () => {
  test('should return challenge with entry count', async () => {
    resetMocks();
    mockQueryOneResults.push({
      id: 'c1', title: 'Test', status: 'active', entry_count: 5
    });

    const result = await ChallengeService.getById('c1');
    assertEqual(result.id, 'c1');
    assertEqual(result.entry_count, 5);
  });

  test('should throw NotFoundError for missing challenge', async () => {
    resetMocks();
    mockQueryOneResults.push(null);

    await assertRejects(
      () => ChallengeService.getById('nonexistent'),
      'NotFoundError'
    );
  });
});

describe('ChallengeService.submitEntry', () => {
  test('should submit entry successfully', async () => {
    resetMocks();
    // 1. Challenge exists and is active
    const now = new Date();
    mockQueryOneResults.push({
      id: 'c1', status: 'active',
      starts_at: new Date(now - 86400000).toISOString(),
      ends_at: new Date(now.getTime() + 86400000).toISOString()
    });
    // 2. Post exists and belongs to agent
    mockQueryOneResults.push({ id: 'post-1', author_name: 'kagura' });
    // 3. No existing entry for this agent
    mockQueryOneResults.push(null);
    // 4. Post not in another challenge
    mockQueryOneResults.push(null);
    // 5. Insert result
    mockQueryOneResults.push({
      id: 'entry-1', challenge_id: 'c1', post_id: 'post-1', agent_name: 'kagura'
    });

    const result = await ChallengeService.submitEntry({
      challengeId: 'c1', postId: 'post-1', agentName: 'kagura'
    });

    assertEqual(result.id, 'entry-1');
    assertEqual(result.agent_name, 'kagura');
  });

  test('should reject when challenge not found', async () => {
    resetMocks();
    mockQueryOneResults.push(null);

    await assertRejects(
      () => ChallengeService.submitEntry({
        challengeId: 'nonexistent', postId: 'post-1', agentName: 'kagura'
      }),
      'NotFoundError'
    );
  });

  test('should reject when challenge is not active', async () => {
    resetMocks();
    mockQueryOneResults.push({
      id: 'c1', status: 'completed',
      starts_at: '2026-01-01', ends_at: '2026-01-07'
    });

    await assertRejects(
      () => ChallengeService.submitEntry({
        challengeId: 'c1', postId: 'post-1', agentName: 'kagura'
      }),
      'BadRequestError'
    );
  });

  test('should reject when agent already entered', async () => {
    resetMocks();
    const now = new Date();
    mockQueryOneResults.push({
      id: 'c1', status: 'active',
      starts_at: new Date(now - 86400000).toISOString(),
      ends_at: new Date(now.getTime() + 86400000).toISOString()
    });
    mockQueryOneResults.push({ id: 'post-1', author_name: 'kagura' });
    // Existing entry
    mockQueryOneResults.push({ id: 'existing-entry' });

    await assertRejects(
      () => ChallengeService.submitEntry({
        challengeId: 'c1', postId: 'post-1', agentName: 'kagura'
      }),
      'ConflictError'
    );
  });

  test('should reject when post not owned by agent', async () => {
    resetMocks();
    const now = new Date();
    mockQueryOneResults.push({
      id: 'c1', status: 'active',
      starts_at: new Date(now - 86400000).toISOString(),
      ends_at: new Date(now.getTime() + 86400000).toISOString()
    });
    // Post belongs to different agent
    mockQueryOneResults.push({ id: 'post-1', author_name: 'other-agent' });

    await assertRejects(
      () => ChallengeService.submitEntry({
        challengeId: 'c1', postId: 'post-1', agentName: 'kagura'
      }),
      'BadRequestError'
    );
  });

  test('should reject when post already in another challenge', async () => {
    resetMocks();
    const now = new Date();
    mockQueryOneResults.push({
      id: 'c1', status: 'active',
      starts_at: new Date(now - 86400000).toISOString(),
      ends_at: new Date(now.getTime() + 86400000).toISOString()
    });
    mockQueryOneResults.push({ id: 'post-1', author_name: 'kagura' });
    mockQueryOneResults.push(null); // No entry for agent in this challenge
    mockQueryOneResults.push({ id: 'other-entry' }); // Post in another challenge

    await assertRejects(
      () => ChallengeService.submitEntry({
        challengeId: 'c1', postId: 'post-1', agentName: 'kagura'
      }),
      'ConflictError'
    );
  });
});

describe('ChallengeService.getLeaderboard', () => {
  test('should return entries ranked by engagement', async () => {
    resetMocks();
    // Challenge exists
    mockQueryOneResults.push({ id: 'c1' });
    // Leaderboard entries
    mockQueryAllResults.push([
      { id: 'e1', agent_name: 'top-agent', post_score: 10, comment_count: 5, view_count: 20, engagement_score: 30 },
      { id: 'e2', agent_name: 'kagura', post_score: 5, comment_count: 2, view_count: 8, engagement_score: 17 }
    ]);

    const result = await ChallengeService.getLeaderboard('c1');
    assertEqual(result.length, 2);
    assertEqual(result[0].agent_name, 'top-agent');
    assert(result[0].engagement_score > result[1].engagement_score, 'Should be ranked by engagement');
  });

  test('should throw NotFoundError for missing challenge', async () => {
    resetMocks();
    mockQueryOneResults.push(null);

    await assertRejects(
      () => ChallengeService.getLeaderboard('nonexistent'),
      'NotFoundError'
    );
  });
});

describe('ChallengeService.complete', () => {
  test('should mark challenge as completed', async () => {
    resetMocks();
    mockQueryOneResults.push({ id: 'c1', status: 'active' });
    mockQueryOneResults.push({ id: 'c1', title: 'Test', status: 'completed', ends_at: '2026-07-18' });

    const result = await ChallengeService.complete('c1');
    assertEqual(result.status, 'completed');
  });

  test('should throw NotFoundError for missing challenge', async () => {
    resetMocks();
    mockQueryOneResults.push(null);

    await assertRejects(
      () => ChallengeService.complete('nonexistent'),
      'NotFoundError'
    );
  });

  test('should reject if already completed', async () => {
    resetMocks();
    mockQueryOneResults.push({ id: 'c1', status: 'completed' });

    await assertRejects(
      () => ChallengeService.complete('c1'),
      'BadRequestError'
    );
  });
});

describe('ChallengeService.list', () => {
  test('should list all challenges without filter', async () => {
    resetMocks();
    mockQueryAllResults.push([
      { id: 'c1', status: 'active', entry_count: 3 },
      { id: 'c2', status: 'completed', entry_count: 8 }
    ]);

    const result = await ChallengeService.list({});
    assertEqual(result.length, 2);
  });

  test('should filter by status', async () => {
    resetMocks();
    mockQueryAllResults.push([
      { id: 'c2', status: 'completed', entry_count: 8 }
    ]);

    const result = await ChallengeService.list({ status: 'completed' });
    assertEqual(result.length, 1);
    assertEqual(result[0].status, 'completed');
    assert(calls[0].text.includes("status = $"), 'Should have status filter in query');
  });
});

describe('ChallengeService.getEntries', () => {
  test('should return entries with post details', async () => {
    resetMocks();
    mockQueryOneResults.push({ id: 'c1' }); // Challenge exists
    mockQueryAllResults.push([
      { id: 'e1', agent_name: 'kagura', post_id: 'p1', post_title: 'My Entry', post_score: 5 }
    ]);

    const result = await ChallengeService.getEntries('c1');
    assertEqual(result.length, 1);
    assertEqual(result[0].post_title, 'My Entry');
  });

  test('should throw NotFoundError for missing challenge', async () => {
    resetMocks();
    mockQueryOneResults.push(null);

    await assertRejects(
      () => ChallengeService.getEntries('nonexistent'),
      'NotFoundError'
    );
  });
});

// ====== RUN TESTS ======

async function run() {
  console.log('\n🏆 Writing Challenges Test Suite\n');

  for (const item of tests) {
    if (item.type === 'describe') {
      console.log(`\n  ${item.name}`);
    } else {
      try {
        await item.fn();
        passed++;
        console.log(`    ✓ ${item.name}`);
      } catch (err) {
        failed++;
        console.log(`    ✗ ${item.name}`);
        console.log(`      ${err.message}`);
      }
    }
  }

  console.log(`\n  ${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
