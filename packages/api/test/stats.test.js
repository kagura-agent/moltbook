/**
 * Stats Endpoint Test Suite
 *
 * Run: node test/stats.test.js
 */

const calls = [];
let mockQueryResults = [];

require.cache[require.resolve('../src/config/database')] = {
  id: require.resolve('../src/config/database'),
  filename: require.resolve('../src/config/database'),
  loaded: true,
  exports: {
    query: async (text, params) => {
      calls.push({ text, params });
      if (mockQueryResults.length > 0) return mockQueryResults.shift();
      return { rows: [{ count: '0' }] };
    }
  }
};

const StatsService = require('../src/services/StatsService');

let passed = 0;
let failed = 0;
const tests = [];

function describe(name, fn) { tests.push({ type: 'describe', name }); fn(); }
function test(name, fn) { tests.push({ type: 'test', name, fn }); }
function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

describe('StatsService.getStats()', () => {
  test('returns 200-compatible shape with all expected fields', async () => {
    mockQueryResults = [
      { rows: [{ count: '42' }] },
      { rows: [{ count: '10' }] },
      { rows: [{ count: '100' }] },
      { rows: [{ count: '5' }] },
      { rows: [{ count: '3' }] },
      { rows: [{ name: 'moltbook', post_count: 20 }, { name: 'general', post_count: 15 }] }
    ];

    const stats = await StatsService.getStats();

    assert(stats.total_posts === 42, `total_posts should be 42, got ${stats.total_posts}`);
    assert(stats.total_agents === 10, `total_agents should be 10, got ${stats.total_agents}`);
    assert(stats.total_comments === 100, `total_comments should be 100`);
    assert(stats.active_agents_7d === 5, `active_agents_7d should be 5`);
    assert(stats.challenges_run === 3, `challenges_run should be 3`);
  });

  test('all numeric fields are numbers', async () => {
    mockQueryResults = [
      { rows: [{ count: '1' }] },
      { rows: [{ count: '2' }] },
      { rows: [{ count: '3' }] },
      { rows: [{ count: '4' }] },
      { rows: [{ count: '5' }] },
      { rows: [] }
    ];

    const stats = await StatsService.getStats();

    assert(typeof stats.total_posts === 'number', 'total_posts must be number');
    assert(typeof stats.total_agents === 'number', 'total_agents must be number');
    assert(typeof stats.total_comments === 'number', 'total_comments must be number');
    assert(typeof stats.active_agents_7d === 'number', 'active_agents_7d must be number');
    assert(typeof stats.challenges_run === 'number', 'challenges_run must be number');
    assert(Array.isArray(stats.top_submolts), 'top_submolts must be array');
  });

  test('top_submolts entries have name and post_count', async () => {
    mockQueryResults = [
      { rows: [{ count: '0' }] },
      { rows: [{ count: '0' }] },
      { rows: [{ count: '0' }] },
      { rows: [{ count: '0' }] },
      { rows: [{ count: '0' }] },
      { rows: [{ name: 'tech', post_count: 8 }, { name: 'art', post_count: 5 }] }
    ];

    const stats = await StatsService.getStats();

    assert(stats.top_submolts.length === 2, 'should have 2 submolts');
    assert(stats.top_submolts[0].name === 'tech', 'first submolt name');
    assert(stats.top_submolts[0].post_count === 8, 'first submolt post_count');
    assert(stats.top_submolts[1].name === 'art', 'second submolt name');
  });
});

// Run tests
(async () => {
  for (const entry of tests) {
    if (entry.type === 'describe') {
      console.log(`\n${entry.name}`);
    } else {
      try {
        calls.length = 0;
        await entry.fn();
        passed++;
        console.log(`  ✓ ${entry.name}`);
      } catch (err) {
        failed++;
        console.log(`  ✗ ${entry.name}: ${err.message}`);
      }
    }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})();
