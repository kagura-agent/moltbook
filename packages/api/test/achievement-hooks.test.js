/**
 * Achievement Hooks Test Suite
 *
 * Verifies that achievement checks fire automatically after
 * post creation, comment creation, and reaction creation.
 *
 * Run: node test/achievement-hooks.test.js
 */

const calls = [];
let mockQueryAllResults = [];
let mockQueryOneResults = [];
let mockExecuteResults = [];

// Track AchievementService.checkAndUnlock calls
const achievementChecks = [];

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
    query: async (text, params) => {
      calls.push({ fn: 'query', text, params });
      if (mockExecuteResults.length > 0) return mockExecuteResults.shift();
      return { rowCount: 1 };
    },
    transaction: async (fn) => fn({ queryOne: async () => null, queryAll: async () => [] })
  }
};

// Mock AchievementService to track calls
require.cache[require.resolve('../src/services/AchievementService')] = {
  id: require.resolve('../src/services/AchievementService'),
  filename: require.resolve('../src/services/AchievementService'),
  loaded: true,
  exports: {
    checkAndUnlock: async (agentId) => {
      achievementChecks.push(agentId);
      return [];
    }
  }
};

// Mock NotificationService
require.cache[require.resolve('../src/services/NotificationService')] = {
  id: require.resolve('../src/services/NotificationService'),
  filename: require.resolve('../src/services/NotificationService'),
  loaded: true,
  exports: {
    create: async () => ({})
  }
};

// Mock AgentService
require.cache[require.resolve('../src/services/AgentService')] = {
  id: require.resolve('../src/services/AgentService'),
  filename: require.resolve('../src/services/AgentService'),
  loaded: true,
  exports: {
    findByName: async () => null
  }
};

// Mock PostMediaService
require.cache[require.resolve('../src/services/PostMediaService')] = {
  id: require.resolve('../src/services/PostMediaService'),
  filename: require.resolve('../src/services/PostMediaService'),
  loaded: true,
  exports: {
    getMediaForPosts: async () => new Map()
  }
};

// Mock mentions
require.cache[require.resolve('../src/utils/mentions')] = {
  id: require.resolve('../src/utils/mentions'),
  filename: require.resolve('../src/utils/mentions'),
  loaded: true,
  exports: {
    parseMentions: () => []
  }
};

const PostService = require('../src/services/PostService');
const CommentService = require('../src/services/CommentService');
const ReactionService = require('../src/services/ReactionService');

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
  achievementChecks.length = 0;
  mockQueryAllResults = [];
  mockQueryOneResults = [];
  mockExecuteResults = [];
}

const AUTHOR_ID = '11111111-1111-1111-1111-111111111111';
const REACTOR_ID = '22222222-2222-2222-2222-222222222222';
const POST_ID = '33333333-3333-3333-3333-333333333333';
const COMMENT_ID = '44444444-4444-4444-4444-444444444444';
const SUBMOLT_ID = '55555555-5555-5555-5555-555555555555';

describe('PostService.create achievement hook', () => {
  test('fires checkAndUnlock for the post author', async () => {
    // submolt lookup
    mockQueryOneResults.push({ id: SUBMOLT_ID });
    // post insert
    mockQueryOneResults.push({ id: POST_ID, title: 'Test', content: 'body', submolt: 'test', post_type: 'text', score: 0, comment_count: 0, flair_id: null, created_at: new Date().toISOString() });
    // submolt post count update
    mockQueryOneResults.push({ post_count: 1 });

    await PostService.create({ authorId: AUTHOR_ID, submolt: 'test', title: 'Test', content: 'body' });

    // Wait for fire-and-forget
    await new Promise(r => setTimeout(r, 10));

    assert(achievementChecks.includes(AUTHOR_ID), `Expected checkAndUnlock to be called with author ID, got: ${JSON.stringify(achievementChecks)}`);
  });
});

describe('CommentService.create achievement hook', () => {
  test('fires checkAndUnlock for the comment author', async () => {
    // post exists check
    mockQueryOneResults.push({ id: POST_ID });
    // comment insert
    mockQueryOneResults.push({ id: COMMENT_ID, content: 'nice', score: 0, depth: 0, created_at: new Date().toISOString() });
    // incrementCommentCount
    mockQueryOneResults.push({ comment_count: 1 });
    // notification: post author lookup
    mockQueryOneResults.push({ author_id: '99999999-9999-9999-9999-999999999999', title: 'Test', submolt: 'test' });

    await CommentService.create({ postId: POST_ID, authorId: AUTHOR_ID, content: 'nice' });

    await new Promise(r => setTimeout(r, 10));

    assert(achievementChecks.includes(AUTHOR_ID), `Expected checkAndUnlock to be called with author ID, got: ${JSON.stringify(achievementChecks)}`);
  });
});

describe('ReactionService.addReaction achievement hook', () => {
  test('fires checkAndUnlock for the POST AUTHOR (not the reactor)', async () => {
    // post exists check - now returns author_id too
    mockQueryOneResults.push({ id: POST_ID, author_id: AUTHOR_ID });
    // reaction insert
    mockQueryOneResults.push({ id: 'r1', post_id: POST_ID, agent_id: REACTOR_ID, reaction_type: 'heart', created_at: new Date().toISOString() });

    await ReactionService.addReaction(POST_ID, REACTOR_ID, 'heart');

    await new Promise(r => setTimeout(r, 10));

    assert(achievementChecks.includes(AUTHOR_ID), `Expected checkAndUnlock for post author ${AUTHOR_ID}, got: ${JSON.stringify(achievementChecks)}`);
    assert(!achievementChecks.includes(REACTOR_ID), 'Should NOT check achievements for the reactor');
  });
});

describe('ReactionService.addCommentReaction achievement hook', () => {
  test('fires checkAndUnlock for the COMMENT AUTHOR (not the reactor)', async () => {
    // comment exists check - now returns author_id too
    mockQueryOneResults.push({ id: COMMENT_ID, author_id: AUTHOR_ID });
    // reaction insert
    mockQueryOneResults.push({ id: 'r2', comment_id: COMMENT_ID, agent_id: REACTOR_ID, reaction_type: 'rocket', created_at: new Date().toISOString() });

    await ReactionService.addCommentReaction(COMMENT_ID, REACTOR_ID, 'rocket');

    await new Promise(r => setTimeout(r, 10));

    assert(achievementChecks.includes(AUTHOR_ID), `Expected checkAndUnlock for comment author ${AUTHOR_ID}, got: ${JSON.stringify(achievementChecks)}`);
    assert(!achievementChecks.includes(REACTOR_ID), 'Should NOT check achievements for the reactor');
  });
});

describe('Achievement hook failure isolation', () => {
  test('post creation succeeds even if achievement check throws', async () => {
    // Override checkAndUnlock to throw
    const origCheck = require('../src/services/AchievementService').checkAndUnlock;
    require('../src/services/AchievementService').checkAndUnlock = async () => { throw new Error('DB down'); };

    // Suppress expected error log
    const origError = console.error;
    const errors = [];
    console.error = (...args) => errors.push(args.join(' '));

    // submolt lookup
    mockQueryOneResults.push({ id: SUBMOLT_ID });
    // post insert
    mockQueryOneResults.push({ id: POST_ID, title: 'Test', content: 'body', submolt: 'test', post_type: 'text', score: 0, comment_count: 0, flair_id: null, created_at: new Date().toISOString() });
    // submolt post count update
    mockQueryOneResults.push({ post_count: 1 });

    const post = await PostService.create({ authorId: AUTHOR_ID, submolt: 'test', title: 'Test', content: 'body' });

    await new Promise(r => setTimeout(r, 10));

    assert(post.id === POST_ID, 'Post should still be created');
    assert(errors.some(e => e.includes('Achievement check failed')), 'Error should be logged');

    // Restore
    require('../src/services/AchievementService').checkAndUnlock = origCheck;
    console.error = origError;
  });
});

async function runTests() {
  console.log('\nAchievement Hooks Test Suite\n');
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

runTests();
