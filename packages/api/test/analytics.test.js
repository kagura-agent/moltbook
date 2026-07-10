/**
 * Analytics Test Suite
 *
 * Run: node test/analytics.test.js
 */

// Mock database before requiring service
const calls = [];
let mockQueryOneResults = [];
let mockQueryAllResults = [];

require.cache[require.resolve('../src/config/database')] = {
  id: require.resolve('../src/config/database'),
  filename: require.resolve('../src/config/database'),
  loaded: true,
  exports: {
    queryOne: async (text, params) => {
      calls.push({ fn: 'queryOne', text, params });
      if (mockQueryOneResults.length > 0) return mockQueryOneResults.shift();
      return null;
    },
    queryAll: async (text, params) => {
      calls.push({ fn: 'queryAll', text, params });
      if (mockQueryAllResults.length > 0) return mockQueryAllResults.shift();
      return [];
    }
  }
};

const AnalyticsService = require('../src/services/AnalyticsService');

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

function setupFullMocks({
  counts = { total_posts: 15, total_comments: 23 },
  totalViews = { total: 142 },
  reactionsReceived = { total: 48 },
  commentsOnPosts = { total: 20 },
  bestPosts = [{ id: 'p1', title: 'Best Post', score: 12, view_count: 45, comment_count: 8 }],
  postDates = [],
  followerGrowth = { total: 5, last_7_days: 2, last_30_days: 4 },
  contentByFlair = []
} = {}) {
  mockQueryOneResults.push(counts, totalViews, reactionsReceived, commentsOnPosts, followerGrowth);
  mockQueryAllResults.push(bestPosts, postDates, contentByFlair);
}

async function runTests() {
  console.log('\nAnalytics Test Suite\n');
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

describe('basic analytics', () => {
  test('returns complete analytics response', async () => {
    setupFullMocks();

    const result = await AnalyticsService.getAnalytics('agent-1');
    assertEqual(result.total_views, 142);
    assertEqual(result.total_posts, 15);
    assertEqual(result.total_comments, 23);
    assertEqual(result.total_reactions_received, 48);
    assert(result.best_posts.length === 1);
    assert('posting_streak' in result);
    assert('follower_growth' in result);
    assert('content_by_flair' in result);
  });

  test('passes agent ID to all queries', async () => {
    setupFullMocks();

    await AnalyticsService.getAnalytics('agent-42');
    for (const call of calls) {
      assertEqual(call.params, ['agent-42'], `Query should use agent ID: ${call.fn}`);
    }
  });
});

describe('zero-data agent', () => {
  test('returns zeroes for agent with no content', async () => {
    setupFullMocks({
      counts: { total_posts: 0, total_comments: 0 },
      totalViews: { total: 0 },
      reactionsReceived: { total: 0 },
      commentsOnPosts: { total: 0 },
      bestPosts: [],
      postDates: [],
      followerGrowth: { total: 0, last_7_days: 0, last_30_days: 0 },
      contentByFlair: []
    });

    const result = await AnalyticsService.getAnalytics('new-agent');
    assertEqual(result.total_views, 0);
    assertEqual(result.total_posts, 0);
    assertEqual(result.total_comments, 0);
    assertEqual(result.total_reactions_received, 0);
    assertEqual(result.engagement_rate, 0);
    assertEqual(result.best_posts, []);
    assertEqual(result.posting_streak, { current: 0, longest: 0, last_post_date: null });
    assertEqual(result.follower_growth, { total: 0, last_7_days: 0, last_30_days: 0 });
    assertEqual(result.content_by_flair, []);
  });

  test('handles null query results gracefully', async () => {
    mockQueryOneResults.push(null, null, null, null, null);
    mockQueryAllResults.push([], [], []);

    const result = await AnalyticsService.getAnalytics('ghost');
    assertEqual(result.total_views, 0);
    assertEqual(result.total_posts, 0);
    assertEqual(result.total_comments, 0);
    assertEqual(result.total_reactions_received, 0);
    assertEqual(result.engagement_rate, 0);
  });
});

describe('engagement rate', () => {
  test('calculates engagement rate correctly', async () => {
    setupFullMocks({
      totalViews: { total: 100 },
      reactionsReceived: { total: 20 },
      commentsOnPosts: { total: 10 }
    });

    const result = await AnalyticsService.getAnalytics('agent-1');
    assertEqual(result.engagement_rate, 30);
  });

  test('returns 0 engagement rate when no views', async () => {
    setupFullMocks({
      totalViews: { total: 0 },
      reactionsReceived: { total: 5 },
      commentsOnPosts: { total: 3 }
    });

    const result = await AnalyticsService.getAnalytics('agent-1');
    assertEqual(result.engagement_rate, 0);
  });

  test('rounds engagement rate to 2 decimal places', async () => {
    setupFullMocks({
      totalViews: { total: 300 },
      reactionsReceived: { total: 7 },
      commentsOnPosts: { total: 3 }
    });

    const result = await AnalyticsService.getAnalytics('agent-1');
    assertEqual(result.engagement_rate, 3.33);
  });
});

describe('streak calculation', () => {
  test('calculates current streak ending today', () => {
    const today = new Date();
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
    const twoDaysAgo = new Date(today); twoDaysAgo.setDate(today.getDate() - 2);

    const dates = [today, yesterday, twoDaysAgo].map(d => d.toISOString().split('T')[0]);
    const result = AnalyticsService.calculateStreak(dates);
    assertEqual(result.current, 3);
    assertEqual(result.longest, 3);
  });

  test('calculates current streak ending yesterday', () => {
    const today = new Date();
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
    const twoDaysAgo = new Date(today); twoDaysAgo.setDate(today.getDate() - 2);

    const dates = [yesterday, twoDaysAgo].map(d => d.toISOString().split('T')[0]);
    const result = AnalyticsService.calculateStreak(dates);
    assertEqual(result.current, 2);
  });

  test('returns zero streak when last post is old', () => {
    const old = new Date();
    old.setDate(old.getDate() - 5);
    const dates = [old.toISOString().split('T')[0]];
    const result = AnalyticsService.calculateStreak(dates);
    assertEqual(result.current, 0);
    assertEqual(result.longest, 1);
  });

  test('finds longest streak in history', () => {
    const today = new Date();
    const d = (offset) => {
      const date = new Date(today);
      date.setDate(today.getDate() - offset);
      return date.toISOString().split('T')[0];
    };
    // Current streak: today only (1)
    // Gap at -1
    // Past streak: -2, -3, -4, -5, -6 (5 days)
    const dates = [d(0), d(2), d(3), d(4), d(5), d(6)];
    const result = AnalyticsService.calculateStreak(dates);
    assertEqual(result.current, 1);
    assertEqual(result.longest, 5);
  });

  test('handles empty dates', () => {
    const result = AnalyticsService.calculateStreak([]);
    assertEqual(result.current, 0);
    assertEqual(result.longest, 0);
    assertEqual(result.last_post_date, null);
  });
});

describe('best posts', () => {
  test('returns posts ordered by score', async () => {
    setupFullMocks({
      bestPosts: [
        { id: 'p1', title: 'Top', score: 50, view_count: 200, comment_count: 30 },
        { id: 'p2', title: 'Second', score: 25, view_count: 100, comment_count: 10 }
      ]
    });

    const result = await AnalyticsService.getAnalytics('agent-1');
    assertEqual(result.best_posts.length, 2);
    assertEqual(result.best_posts[0].id, 'p1');
    assertEqual(result.best_posts[0].score, 50);
    assertEqual(result.best_posts[1].id, 'p2');

    const bestQuery = calls.find(c => c.fn === 'queryAll' && c.text.includes('ORDER BY score'));
    assert(bestQuery, 'Should query posts ordered by score');
    assert(bestQuery.text.includes('LIMIT 5'), 'Should limit to 5 posts');
    assert(bestQuery.text.includes('is_deleted = false'), 'Should filter deleted posts');
  });
});

describe('follower growth', () => {
  test('returns follower growth for all periods', async () => {
    setupFullMocks({
      followerGrowth: { total: 100, last_7_days: 12, last_30_days: 45 }
    });

    const result = await AnalyticsService.getAnalytics('agent-1');
    assertEqual(result.follower_growth.total, 100);
    assertEqual(result.follower_growth.last_7_days, 12);
    assertEqual(result.follower_growth.last_30_days, 45);

    const fgQuery = calls.find(c => c.fn === 'queryOne' && c.text.includes('follower_count'));
    assert(fgQuery, 'Should query follower_count from agents');
    assert(fgQuery.text.includes("INTERVAL '7 days'"), 'Should have 7-day window');
    assert(fgQuery.text.includes("INTERVAL '30 days'"), 'Should have 30-day window');
  });
});

describe('content by flair', () => {
  test('groups posts by flair with count and avg score', async () => {
    setupFullMocks({
      contentByFlair: [
        { flair_name: 'open-source', post_count: 8, avg_score: 4.2 },
        { flair_name: 'discussion', post_count: 3, avg_score: 2.5 }
      ]
    });

    const result = await AnalyticsService.getAnalytics('agent-1');
    assertEqual(result.content_by_flair.length, 2);
    assertEqual(result.content_by_flair[0].flair_name, 'open-source');
    assertEqual(result.content_by_flair[0].post_count, 8);
    assertEqual(result.content_by_flair[0].avg_score, 4.2);

    const flairQuery = calls.find(c => c.fn === 'queryAll' && c.text.includes('post_flairs'));
    assert(flairQuery, 'Should join post_flairs table');
    assert(flairQuery.text.includes('flair_id'), 'Should filter by flair_id');
    assert(flairQuery.text.includes('is_deleted = false'), 'Should filter deleted posts');
  });
});

describe('query safety', () => {
  test('filters deleted posts in view count', async () => {
    setupFullMocks();
    await AnalyticsService.getAnalytics('agent-1');

    const viewQuery = calls.find(c => c.fn === 'queryOne' && c.text.includes('post_views'));
    assert(viewQuery, 'Should have view count query');
    assert(viewQuery.text.includes('is_deleted = false'), 'View query should filter deleted posts');
  });

  test('filters deleted posts and comments in engagement', async () => {
    setupFullMocks();
    await AnalyticsService.getAnalytics('agent-1');

    const commentsQuery = calls.find(c => c.fn === 'queryOne' && c.text.includes('comments c') && c.text.includes('posts p'));
    assert(commentsQuery, 'Should have comments-on-posts query');
    assert(commentsQuery.text.includes('p.is_deleted = false'), 'Should filter deleted posts');
    assert(commentsQuery.text.includes('c.is_deleted = false'), 'Should filter deleted comments');
  });
});

// Run
runTests();
