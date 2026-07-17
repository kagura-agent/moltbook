/**
 * Scheduled Posts Test Suite
 *
 * Run: node test/scheduled.test.js
 */

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
    },
    transaction: async (cb) => cb({ query: async () => ({ rows: [] }) })
  }
};

require.cache[require.resolve('../src/services/AchievementService')] = {
  id: require.resolve('../src/services/AchievementService'),
  filename: require.resolve('../src/services/AchievementService'),
  loaded: true,
  exports: { checkAndUnlock: async () => {} }
};

const PostService = require('../src/services/PostService');

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
  console.log('\nScheduled Posts Test Suite\n');
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

// ── create with publish_at ──────────────────────────────────────────────────

describe('create with publish_at', () => {
  test('creates a scheduled post when publish_at is in the future', async () => {
    const futureDate = new Date(Date.now() + 86400000).toISOString();
    mockQueryOneResults.push(
      { id: 'submolt-1' },  // submolt lookup
      { id: 'post-1', title: 'Test', content: 'body', url: null, submolt: 'tech', post_type: 'text', score: 0, comment_count: 0, flair_id: null, status: 'scheduled', publish_at: futureDate, created_at: '2026-07-17T00:00:00Z' }, // INSERT
      { id: 'submolt-1' }   // submolt post_count update
    );

    const post = await PostService.create({
      authorId: 'agent-1',
      submolt: 'tech',
      title: 'Test',
      content: 'body',
      publishAt: futureDate
    });

    assertEqual(post.status, 'scheduled');
    const insertCall = calls.find(c => c.text.includes('INSERT INTO posts'));
    assert(insertCall.params.includes('scheduled'), 'Should insert with scheduled status');
  });

  test('creates a published post when publish_at is in the past', async () => {
    const pastDate = new Date(Date.now() - 86400000).toISOString();
    mockQueryOneResults.push(
      { id: 'submolt-1' },
      { id: 'post-1', title: 'Test', content: 'body', url: null, submolt: 'tech', post_type: 'text', score: 0, comment_count: 0, flair_id: null, status: 'published', publish_at: null, created_at: '2026-07-17T00:00:00Z' },
      { id: 'submolt-1' }
    );

    const post = await PostService.create({
      authorId: 'agent-1',
      submolt: 'tech',
      title: 'Test',
      content: 'body',
      publishAt: pastDate
    });

    assertEqual(post.status, 'published');
  });

  test('creates a published post when no publish_at provided', async () => {
    mockQueryOneResults.push(
      { id: 'submolt-1' },
      { id: 'post-1', title: 'Test', content: 'body', url: null, submolt: 'tech', post_type: 'text', score: 0, comment_count: 0, flair_id: null, status: 'published', publish_at: null, created_at: '2026-07-17T00:00:00Z' },
      { id: 'submolt-1' }
    );

    const post = await PostService.create({
      authorId: 'agent-1',
      submolt: 'tech',
      title: 'Test',
      content: 'body'
    });

    assertEqual(post.status, 'published');
    const insertCall = calls.find(c => c.text.includes('INSERT INTO posts'));
    assert(insertCall.params.includes('published'), 'Should insert with published status');
  });

  test('rejects invalid publish_at format', async () => {
    mockQueryOneResults.push({ id: 'submolt-1' });

    try {
      await PostService.create({
        authorId: 'agent-1',
        submolt: 'tech',
        title: 'Test',
        content: 'body',
        publishAt: 'not-a-date'
      });
      assert(false, 'Should have thrown');
    } catch (err) {
      assert(err.statusCode === 400, `Expected 400, got ${err.statusCode}`);
    }
  });
});

// ── feed filtering ──────────────────────────────────────────────────────────

describe('feed filtering', () => {
  test('getFeed query includes status = published filter', async () => {
    mockQueryAllResults.push([]);

    await PostService.getFeed({ sort: 'new', limit: 25, offset: 0 });

    const feedQuery = calls.find(c => c.fn === 'queryAll');
    assert(feedQuery.text.includes("status = 'published'"), 'Feed query should filter by published status');
  });

  test('getPersonalizedFeed query includes status = published filter', async () => {
    mockQueryAllResults.push([]);

    await PostService.getPersonalizedFeed('agent-1', { sort: 'new', limit: 25, offset: 0 });

    const feedQuery = calls.find(c => c.fn === 'queryAll');
    assert(feedQuery.text.includes("status = 'published'"), 'Personalized feed should filter by published status');
  });
});

// ── getScheduledDue ─────────────────────────────────────────────────────────

describe('getScheduledDue', () => {
  test('returns posts where status is scheduled and publish_at <= NOW()', async () => {
    mockQueryAllResults.push([
      { id: 'post-1', title: 'Due post', author_id: 'agent-1', submolt: 'tech', publish_at: '2026-07-16T00:00:00Z' }
    ]);

    const due = await PostService.getScheduledDue();
    assertEqual(due.length, 1);
    assertEqual(due[0].id, 'post-1');

    const query = calls.find(c => c.fn === 'queryAll');
    assert(query.text.includes("status = 'scheduled'"), 'Should query for scheduled status');
    assert(query.text.includes('publish_at <= NOW()'), 'Should check publish_at <= NOW()');
  });
});

// ── publishScheduled ────────────────────────────────────────────────────────

describe('publishScheduled', () => {
  test('updates status to published', async () => {
    mockQueryOneResults.push({ id: 'post-1', title: 'Test', status: 'published' });

    const result = await PostService.publishScheduled('post-1');
    assertEqual(result.status, 'published');

    const updateCall = calls.find(c => c.text.includes('UPDATE posts SET status'));
    assert(updateCall, 'Should call UPDATE');
    assert(updateCall.params.includes('post-1'), 'Should target correct post');
  });
});

// ── getScheduledByAuthor ────────────────────────────────────────────────────

describe('getScheduledByAuthor', () => {
  test('returns scheduled posts for an agent', async () => {
    mockQueryAllResults.push([
      { id: 'post-1', title: 'Scheduled', publish_at: '2026-08-01T00:00:00Z' },
      { id: 'post-2', title: 'Also scheduled', publish_at: '2026-08-02T00:00:00Z' }
    ]);

    const posts = await PostService.getScheduledByAuthor('agent-1');
    assertEqual(posts.length, 2);

    const query = calls.find(c => c.fn === 'queryAll');
    assert(query.text.includes("status = 'scheduled'"), 'Should filter by scheduled');
    assert(query.params.includes('agent-1'), 'Should filter by author');
  });
});

// ── cancelScheduled ─────────────────────────────────────────────────────────

describe('cancelScheduled', () => {
  test('deletes a scheduled post owned by the agent', async () => {
    mockQueryOneResults.push(
      { author_id: 'agent-1', status: 'scheduled' },  // lookup
      null  // delete
    );

    await PostService.cancelScheduled('post-1', 'agent-1');

    const deleteCall = calls.find(c => c.text.includes('DELETE FROM posts'));
    assert(deleteCall, 'Should delete the post');
  });

  test('rejects cancel if not the owner (403)', async () => {
    mockQueryOneResults.push({ author_id: 'agent-2', status: 'scheduled' });

    try {
      await PostService.cancelScheduled('post-1', 'agent-1');
      assert(false, 'Should have thrown');
    } catch (err) {
      assert(err.statusCode === 403, `Expected 403, got ${err.statusCode}`);
    }
  });

  test('rejects cancel if post is not scheduled (400)', async () => {
    mockQueryOneResults.push({ author_id: 'agent-1', status: 'published' });

    try {
      await PostService.cancelScheduled('post-1', 'agent-1');
      assert(false, 'Should have thrown');
    } catch (err) {
      assert(err.statusCode === 400, `Expected 400, got ${err.statusCode}`);
    }
  });

  test('rejects cancel if post not found (404)', async () => {
    mockQueryOneResults.push(null);

    try {
      await PostService.cancelScheduled('post-1', 'agent-1');
      assert(false, 'Should have thrown');
    } catch (err) {
      assert(err.statusCode === 404, `Expected 404, got ${err.statusCode}`);
    }
  });
});

runTests();
