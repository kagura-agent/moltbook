/**
 * Achievement Test Suite
 *
 * Run: node test/achievements.test.js
 */

// Mock database before requiring service
const calls = [];
let mockQueryAllResults = [];
let mockQueryOneResults = [];
let mockExecuteResults = [];

require.cache[require.resolve('../src/config/database')] = {
  id: require.resolve('../src/config/database'),
  filename: require.resolve('../src/config/database'),
  loaded: true,
  exports: {
    queryAll: async (text, params) => {
      calls.push({ fn: 'queryAll', text, params });
      if (mockQueryAllResults.length > 0) return mockQueryAllResults.shift();
      return [];
    },
    queryOne: async (text, params) => {
      calls.push({ fn: 'queryOne', text, params });
      if (mockQueryOneResults.length > 0) return mockQueryOneResults.shift();
      return null;
    },
    execute: async (text, params) => {
      calls.push({ fn: 'execute', text, params });
      if (mockExecuteResults.length > 0) return mockExecuteResults.shift();
      return { rowCount: 1 };
    }
  }
};

const AchievementService = require('../src/services/AchievementService');

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
  mockQueryAllResults = [];
  mockQueryOneResults = [];
  mockExecuteResults = [];
}

// Helpers
const DEFINITIONS = [
  { key: 'first_post', name: 'First Post', description: 'Published your first post', icon: '📝', category: 'posting', threshold: 1 },
  { key: 'prolific_writer', name: 'Prolific Writer', description: 'Published 10 posts', icon: '✍️', category: 'posting', threshold: 10 },
  { key: 'first_comment', name: 'First Comment', description: 'Left your first comment', icon: '💬', category: 'engagement', threshold: 1 },
  { key: 'active_commenter', name: 'Active Commenter', description: 'Left 5 comments', icon: '🗣️', category: 'engagement', threshold: 5 },
  { key: 'first_reaction_received', name: 'First Reaction', description: 'Received your first reaction', icon: '⭐', category: 'popularity', threshold: 1 },
  { key: 'popular', name: 'Popular', description: 'Received 10 reactions on your posts', icon: '🔥', category: 'popularity', threshold: 10 },
  { key: 'streak_3d', name: '3-Day Streak', description: 'Posted on 3 consecutive days', icon: '🔥', category: 'consistency', threshold: 3 },
  { key: 'early_adopter', name: 'Early Adopter', description: 'Joined within the first month of the platform', icon: '🌱', category: 'special', threshold: 1 }
];

const AGENT_ID = '11111111-1111-1111-1111-111111111111';

function setupCheckMocks({ existingKeys = [], posts = 0, comments = 0, reactions = 0, streakDates = [], isEarly = false }) {
  // queryAll: definitions
  mockQueryAllResults.push(DEFINITIONS);
  // queryAll: existing achievements
  mockQueryAllResults.push(existingKeys.map(k => ({ achievement_key: k })));
  // queryOne: posts count
  mockQueryOneResults.push({ count: posts });
  // queryOne: comments count
  mockQueryOneResults.push({ count: comments });
  // queryOne: reactions count
  mockQueryOneResults.push({ count: reactions });
  // queryAll: streak dates
  mockQueryAllResults.push(streakDates.map(d => ({ post_date: d })));
  // queryOne: early adopter
  mockQueryOneResults.push({ is_early: isEarly });
}

async function runTests() {
  console.log('\nAchievement Test Suite\n');
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

describe('checkAndUnlock', () => {
  test('grants first_post when agent has 1+ posts', async () => {
    setupCheckMocks({ posts: 1 });
    const result = await AchievementService.checkAndUnlock(AGENT_ID);
    const keys = result.map(r => r.key);
    assert(keys.includes('first_post'), 'Should unlock first_post');
  });

  test('grants prolific_writer at 10+ posts', async () => {
    setupCheckMocks({ posts: 10 });
    const result = await AchievementService.checkAndUnlock(AGENT_ID);
    const keys = result.map(r => r.key);
    assert(keys.includes('prolific_writer'), 'Should unlock prolific_writer');
  });

  test('grants first_comment at 1+ comments', async () => {
    setupCheckMocks({ comments: 1 });
    const result = await AchievementService.checkAndUnlock(AGENT_ID);
    const keys = result.map(r => r.key);
    assert(keys.includes('first_comment'), 'Should unlock first_comment');
  });

  test('grants active_commenter at 5+ comments', async () => {
    setupCheckMocks({ comments: 5 });
    const result = await AchievementService.checkAndUnlock(AGENT_ID);
    const keys = result.map(r => r.key);
    assert(keys.includes('active_commenter'), 'Should unlock active_commenter');
  });

  test('does not double-grant already unlocked', async () => {
    setupCheckMocks({ existingKeys: ['first_post'], posts: 5 });
    const result = await AchievementService.checkAndUnlock(AGENT_ID);
    const keys = result.map(r => r.key);
    assert(!keys.includes('first_post'), 'Should not re-grant first_post');
  });

  test('returns only newly unlocked achievements', async () => {
    setupCheckMocks({ existingKeys: ['first_post', 'first_comment'], posts: 2, comments: 3 });
    const result = await AchievementService.checkAndUnlock(AGENT_ID);
    assertEqual(result.length, 0, 'Nothing new should be unlocked');
  });

  test('grants first_reaction_received at 1+ reaction', async () => {
    setupCheckMocks({ reactions: 1 });
    const result = await AchievementService.checkAndUnlock(AGENT_ID);
    const keys = result.map(r => r.key);
    assert(keys.includes('first_reaction_received'), 'Should unlock first_reaction_received');
  });

  test('grants popular at 10+ reactions', async () => {
    setupCheckMocks({ reactions: 10 });
    const result = await AchievementService.checkAndUnlock(AGENT_ID);
    const keys = result.map(r => r.key);
    assert(keys.includes('popular'), 'Should unlock popular');
  });

  test('grants streak_3d for 3 consecutive days', async () => {
    setupCheckMocks({ streakDates: ['2025-03-01', '2025-03-02', '2025-03-03'] });
    const result = await AchievementService.checkAndUnlock(AGENT_ID);
    const keys = result.map(r => r.key);
    assert(keys.includes('streak_3d'), 'Should unlock streak_3d');
  });

  test('does not grant streak_3d for non-consecutive days', async () => {
    setupCheckMocks({ streakDates: ['2025-03-01', '2025-03-03', '2025-03-05'] });
    const result = await AchievementService.checkAndUnlock(AGENT_ID);
    const keys = result.map(r => r.key);
    assert(!keys.includes('streak_3d'), 'Should not unlock streak_3d');
  });

  test('grants early_adopter when account is within first month', async () => {
    setupCheckMocks({ isEarly: true });
    const result = await AchievementService.checkAndUnlock(AGENT_ID);
    const keys = result.map(r => r.key);
    assert(keys.includes('early_adopter'), 'Should unlock early_adopter');
  });

  test('does not grant early_adopter for late accounts', async () => {
    setupCheckMocks({ isEarly: false });
    const result = await AchievementService.checkAndUnlock(AGENT_ID);
    const keys = result.map(r => r.key);
    assert(!keys.includes('early_adopter'), 'Should not unlock early_adopter');
  });
});

describe('getAgentAchievements', () => {
  test('returns all unlocked achievements for agent', async () => {
    mockQueryOneResults.push({ id: AGENT_ID });
    mockQueryAllResults.push([
      { key: 'first_post', name: 'First Post', description: 'Published your first post', icon: '📝', category: 'posting', unlocked_at: '2025-03-01T00:00:00Z' }
    ]);

    const result = await AchievementService.getAgentAchievements('test-agent');
    assertEqual(result.length, 1);
    assertEqual(result[0].key, 'first_post');
  });

  test('returns empty array for agent with no achievements', async () => {
    mockQueryOneResults.push({ id: AGENT_ID });
    mockQueryAllResults.push([]);

    const result = await AchievementService.getAgentAchievements('test-agent');
    assertEqual(result, []);
  });

  test('throws NotFoundError for invalid agent name', async () => {
    mockQueryOneResults.push(null);

    try {
      await AchievementService.getAgentAchievements('nonexistent');
      assert(false, 'Should have thrown');
    } catch (err) {
      assert(err.statusCode === 404, `Expected 404, got ${err.statusCode}`);
    }
  });
});

describe('getAllDefinitions', () => {
  test('returns all 8 definitions', async () => {
    mockQueryAllResults.push(DEFINITIONS);

    const result = await AchievementService.getAllDefinitions();
    assertEqual(result.length, 8);
  });
});

// Run
runTests();
