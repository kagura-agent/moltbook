/**
 * Leaderboard Test Suite
 *
 * Run: node test/leaderboard.test.js
 */

// Mock database before requiring service
const calls = [];
let mockQueryAllResults = [];

require.cache[require.resolve('../src/config/database')] = {
  id: require.resolve('../src/config/database'),
  filename: require.resolve('../src/config/database'),
  loaded: true,
  exports: {
    queryAll: async (text, params) => {
      calls.push({ fn: 'queryAll', text, params });
      if (mockQueryAllResults.length > 0) return mockQueryAllResults.shift();
      return [];
    }
  }
};

const LeaderboardService = require('../src/services/LeaderboardService');

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
}

async function runTests() {
  console.log('\nLeaderboard Test Suite\n');
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

describe('posts category', () => {
  test('returns ranked agents by post count', async () => {
    mockQueryAllResults.push([
      { name: 'agent-alpha', display_name: 'Alpha', avatar_url: 'https://a.co/1.png', score: 15 },
      { name: 'agent-beta', display_name: 'Beta', avatar_url: null, score: 8 }
    ]);

    const results = await LeaderboardService.getLeaderboard('weekly', 'posts', 10);
    assertEqual(results.length, 2);
    assertEqual(results[0].rank, 1);
    assertEqual(results[0].name, 'agent-alpha');
    assertEqual(results[0].score, 15);
    assertEqual(results[1].rank, 2);
    assertEqual(results[1].name, 'agent-beta');
    assertEqual(results[1].score, 8);

    const query = calls[0].text;
    assert(query.includes('posts p'), 'Should query posts table');
    assert(query.includes('COUNT(p.id)'), 'Should count post IDs');
  });
});

describe('comments category', () => {
  test('returns ranked agents by comment count', async () => {
    mockQueryAllResults.push([
      { name: 'agent-gamma', display_name: 'Gamma', avatar_url: null, score: 42 }
    ]);

    const results = await LeaderboardService.getLeaderboard('weekly', 'comments', 10);
    assertEqual(results.length, 1);
    assertEqual(results[0].rank, 1);
    assertEqual(results[0].name, 'agent-gamma');
    assertEqual(results[0].score, 42);

    const query = calls[0].text;
    assert(query.includes('comments c'), 'Should query comments table');
    assert(query.includes('COUNT(c.id)'), 'Should count comment IDs');
  });
});

describe('reactions_received category', () => {
  test('returns ranked agents by reactions received', async () => {
    mockQueryAllResults.push([
      { name: 'agent-delta', display_name: 'Delta', avatar_url: 'https://a.co/d.png', score: 100 }
    ]);

    const results = await LeaderboardService.getLeaderboard('monthly', 'reactions_received', 5);
    assertEqual(results.length, 1);
    assertEqual(results[0].rank, 1);
    assertEqual(results[0].score, 100);

    const query = calls[0].text;
    assert(query.includes('reactions r'), 'Should query reactions table');
    assert(query.includes('JOIN posts p'), 'Should join posts');
    assert(query.includes('COUNT(r.id)'), 'Should count reaction IDs');
  });
});

describe('periods', () => {
  test('weekly period uses 7 days interval', async () => {
    mockQueryAllResults.push([]);

    await LeaderboardService.getLeaderboard('weekly', 'posts', 10);
    const query = calls[0].text;
    assert(query.includes("INTERVAL '7 days'"), `Should use 7 days interval, got: ${query}`);
  });

  test('monthly period uses 30 days interval', async () => {
    mockQueryAllResults.push([]);

    await LeaderboardService.getLeaderboard('monthly', 'posts', 10);
    const query = calls[0].text;
    assert(query.includes("INTERVAL '30 days'"), `Should use 30 days interval, got: ${query}`);
  });

  test('all period has no time constraint', async () => {
    mockQueryAllResults.push([]);

    await LeaderboardService.getLeaderboard('all', 'posts', 10);
    const query = calls[0].text;
    assert(!query.includes('INTERVAL'), 'Should not have INTERVAL for all-time');
  });
});

describe('default params', () => {
  test('defaults to weekly/posts/10', async () => {
    mockQueryAllResults.push([]);

    await LeaderboardService.getLeaderboard();
    const query = calls[0].text;
    assert(query.includes("INTERVAL '7 days'"), 'Should default to weekly');
    assert(query.includes('posts p'), 'Should default to posts category');
    assertEqual(calls[0].params, [10], 'Should default limit to 10');
  });
});

describe('invalid params', () => {
  test('rejects invalid period', async () => {
    try {
      await LeaderboardService.getLeaderboard('daily', 'posts', 10);
      assert(false, 'Should have thrown');
    } catch (err) {
      assert(err.statusCode === 400, `Expected 400, got ${err.statusCode}`);
      assert(err.code === 'INVALID_PERIOD', `Expected INVALID_PERIOD, got ${err.code}`);
      assert(err.message.includes('daily'), `Should mention invalid value, got: ${err.message}`);
    }
  });

  test('rejects invalid category', async () => {
    try {
      await LeaderboardService.getLeaderboard('weekly', 'likes', 10);
      assert(false, 'Should have thrown');
    } catch (err) {
      assert(err.statusCode === 400, `Expected 400, got ${err.statusCode}`);
      assert(err.code === 'INVALID_CATEGORY', `Expected INVALID_CATEGORY, got ${err.code}`);
      assert(err.message.includes('likes'), `Should mention invalid value, got: ${err.message}`);
    }
  });
});

describe('empty results', () => {
  test('returns empty array when no data', async () => {
    mockQueryAllResults.push([]);

    const results = await LeaderboardService.getLeaderboard('weekly', 'posts', 10);
    assertEqual(results, []);
  });
});

describe('limit parameter', () => {
  test('passes limit to query', async () => {
    mockQueryAllResults.push([]);

    await LeaderboardService.getLeaderboard('weekly', 'posts', 25);
    assertEqual(calls[0].params, [25]);
  });

  test('clamps limit to max 50', async () => {
    mockQueryAllResults.push([]);

    await LeaderboardService.getLeaderboard('weekly', 'posts', 100);
    assertEqual(calls[0].params, [50]);
  });

  test('clamps limit to min 1', async () => {
    mockQueryAllResults.push([]);

    await LeaderboardService.getLeaderboard('weekly', 'posts', 0);
    assertEqual(calls[0].params, [1]);
  });
});

describe('response shape', () => {
  test('includes all expected fields', async () => {
    mockQueryAllResults.push([
      { name: 'agent-one', display_name: 'Agent One', avatar_url: 'https://a.co/1.png', score: 5 }
    ]);

    const results = await LeaderboardService.getLeaderboard('weekly', 'posts', 10);
    const entry = results[0];
    assert('rank' in entry, 'Should have rank');
    assert('name' in entry, 'Should have name');
    assert('display_name' in entry, 'Should have display_name');
    assert('avatar_url' in entry, 'Should have avatar_url');
    assert('score' in entry, 'Should have score');
    assertEqual(Object.keys(entry).length, 5, 'Should have exactly 5 fields');
  });
});

// Run
runTests();
