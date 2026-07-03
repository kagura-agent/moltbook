/**
 * Subscribed Feed Test Suite
 *
 * Run: node test/subscribed-feed.test.js
 */

// Mock database before requiring service
const calls = [];
let mockQueryAllResults = [];

require.cache[require.resolve('../src/config/database')] = {
  id: require.resolve('../src/config/database'),
  filename: require.resolve('../src/config/database'),
  loaded: true,
  exports: {
    queryOne: async (text, params) => {
      calls.push({ fn: 'queryOne', text, params });
      return null;
    },
    queryAll: async (text, params) => {
      calls.push({ fn: 'queryAll', text, params });
      if (mockQueryAllResults.length > 0) return mockQueryAllResults.shift();
      return [];
    },
    transaction: async (fn) => {
      calls.push({ fn: 'transaction' });
      const mockClient = { query: async (text, params) => { calls.push({ fn: 'client.query', text, params }); } };
      return fn(mockClient);
    }
  }
};

// Mock NotificationService
require.cache[require.resolve('../src/services/NotificationService')] = {
  id: require.resolve('../src/services/NotificationService'),
  filename: require.resolve('../src/services/NotificationService'),
  loaded: true,
  exports: { create: async () => ({ id: 'notif-1' }) }
};

const PostService = require('../src/services/PostService');

// Test framework
let passed = 0;
let failed = 0;

function reset() {
  calls.length = 0;
  mockQueryAllResults = [];
}

async function test(name, fn) {
  reset();
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(msg || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// Tests
(async () => {
  console.log('PostService.getSubscribedFeed tests:\n');

  await test('returns posts from subscribed submolts', async () => {
    mockQueryAllResults = [[
      { id: 'p1', title: 'Post 1', content: 'Hello', url: null, submolt: 'tech', post_type: 'text',
        score: 5, comment_count: 2, created_at: '2026-01-01', flair_id: null,
        author_name: 'bot_a', author_display_name: 'Bot A',
        reaction_counts: '{}', bookmark_count: 0,
        flair_id_ref: null, flair_name: null, flair_color: null }
    ]];

    const result = await PostService.getSubscribedFeed('agent-1', { sort: 'hot', limit: 25, offset: 0 });
    assertEqual(result.length, 1);
    assertEqual(result[0].id, 'p1');
    assertEqual(result[0].title, 'Post 1');
  });

  await test('SQL joins subscriptions table', async () => {
    mockQueryAllResults = [[]];

    await PostService.getSubscribedFeed('agent-1', { sort: 'hot', limit: 25, offset: 0 });
    const query = calls.find(c => c.fn === 'queryAll');
    assert(query, 'should call queryAll');
    assert(query.text.includes('JOIN subscriptions s ON p.submolt_id = s.submolt_id'), 'should JOIN subscriptions on submolt_id');
    assert(query.text.includes('s.agent_id = $1'), 'should filter by agent_id param');
  });

  await test('SQL does NOT join follows table', async () => {
    mockQueryAllResults = [[]];

    await PostService.getSubscribedFeed('agent-1', { sort: 'hot', limit: 25, offset: 0 });
    const query = calls.find(c => c.fn === 'queryAll');
    assert(!query.text.includes('JOIN follows'), 'should not JOIN follows table');
  });

  await test('passes agentId, limit, offset as params', async () => {
    mockQueryAllResults = [[]];

    await PostService.getSubscribedFeed('agent-42', { sort: 'new', limit: 10, offset: 5 });
    const query = calls.find(c => c.fn === 'queryAll');
    assertEqual(query.params[0], 'agent-42', 'param $1 should be agentId');
    assertEqual(query.params[1], 10, 'param $2 should be limit');
    assertEqual(query.params[2], 5, 'param $3 should be offset');
  });

  await test('sort=new orders by created_at DESC', async () => {
    mockQueryAllResults = [[]];

    await PostService.getSubscribedFeed('agent-1', { sort: 'new', limit: 25, offset: 0 });
    const query = calls.find(c => c.fn === 'queryAll');
    assert(query.text.includes('ORDER BY p.created_at DESC'), 'should order by created_at DESC');
  });

  await test('sort=top orders by score DESC', async () => {
    mockQueryAllResults = [[]];

    await PostService.getSubscribedFeed('agent-1', { sort: 'top', limit: 25, offset: 0 });
    const query = calls.find(c => c.fn === 'queryAll');
    assert(query.text.includes('ORDER BY p.score DESC'), 'should order by score DESC');
  });

  await test('sort=hot uses engagement-weighted formula', async () => {
    mockQueryAllResults = [[]];

    await PostService.getSubscribedFeed('agent-1', { sort: 'hot', limit: 25, offset: 0 });
    const query = calls.find(c => c.fn === 'queryAll');
    assert(query.text.includes('POWER(EXTRACT(EPOCH'), 'should use time-decay formula');
    assert(query.text.includes('comment_count * 2'), 'should weight comments');
  });

  await test('returns empty array when no subscriptions', async () => {
    mockQueryAllResults = [[]];

    const result = await PostService.getSubscribedFeed('agent-1', { sort: 'hot', limit: 25, offset: 0 });
    assertEqual(result.length, 0);
  });

  await test('maps flair fields into flair object', async () => {
    mockQueryAllResults = [[
      { id: 'p2', title: 'Flaired Post', content: 'Hi', url: null, submolt: 'art', post_type: 'text',
        score: 1, comment_count: 0, created_at: '2026-01-02', flair_id: 'f1',
        author_name: 'bot_b', author_display_name: 'Bot B',
        reaction_counts: '{}', bookmark_count: 0,
        flair_id_ref: 'f1', flair_name: 'Discussion', flair_color: '#ff0000' }
    ]];

    const result = await PostService.getSubscribedFeed('agent-1', { sort: 'new', limit: 25, offset: 0 });
    assertEqual(result.length, 1);
    assertEqual(result[0].flair.id, 'f1');
    assertEqual(result[0].flair.name, 'Discussion');
    assertEqual(result[0].flair.color, '#ff0000');
    assertEqual(result[0].flair_id_ref, undefined, 'should strip raw flair_id_ref');
    assertEqual(result[0].flair_name, undefined, 'should strip raw flair_name');
  });

  await test('sets flair to null when no flair assigned', async () => {
    mockQueryAllResults = [[
      { id: 'p3', title: 'No Flair', content: 'X', url: null, submolt: 'misc', post_type: 'text',
        score: 0, comment_count: 0, created_at: '2026-01-03', flair_id: null,
        author_name: 'bot_c', author_display_name: 'Bot C',
        reaction_counts: '{}', bookmark_count: 0,
        flair_id_ref: null, flair_name: null, flair_color: null }
    ]];

    const result = await PostService.getSubscribedFeed('agent-1', { sort: 'new', limit: 25, offset: 0 });
    assertEqual(result[0].flair, null);
  });

  // Summary
  console.log(`\n${passed + failed} tests, ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})();
