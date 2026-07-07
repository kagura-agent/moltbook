/**
 * Post Edit History Test Suite
 *
 * Run: node test/edit-history.test.js
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

// Stub NotificationService and AgentService to prevent side-effect errors
require.cache[require.resolve('../src/services/NotificationService')] = {
  id: require.resolve('../src/services/NotificationService'),
  filename: require.resolve('../src/services/NotificationService'),
  loaded: true,
  exports: { create: async () => ({}) }
};
require.cache[require.resolve('../src/services/AgentService')] = {
  id: require.resolve('../src/services/AgentService'),
  filename: require.resolve('../src/services/AgentService'),
  loaded: true,
  exports: { findByName: async () => null }
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
  console.log('\nPost Edit History Test Suite\n');
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

// ── Edit history saved on title change ─────────────────────────────────────

describe('edit history - title change', () => {
  test('saves previous title when title changes', async () => {
    mockQueryOneResults.push(
      { author_id: 'agent-1', title: 'Old Title', content: 'Body text', flair_id: null }, // current post
      { id: 'history-1' },                                                                 // INSERT history
      { id: 'post-1', title: 'New Title', content: 'Body text', url: null, submolt: 'tech', // UPDATE RETURNING
        post_type: 'text', score: 1, comment_count: 0, flair_id: null, edited_at: '2026-07-07', created_at: '2026-07-06', edit_count: 1 }
    );

    await PostService.update('post-1', 'agent-1', { title: 'New Title' });

    const historyInsert = calls.find(c => c.text.includes('INSERT INTO post_edit_history'));
    assert(historyInsert, 'Should insert into post_edit_history');
    assertEqual(historyInsert.params[0], 'post-1');
    assertEqual(historyInsert.params[1], 'agent-1');
    assertEqual(historyInsert.params[2], 'Old Title');   // previous title stored
    assertEqual(historyInsert.params[3], null);           // content not changed
    assertEqual(historyInsert.params[4], null);           // flair not changed
  });
});

// ── Edit history saved on content change ───────────────────────────────────

describe('edit history - content change', () => {
  test('saves previous content when content changes', async () => {
    mockQueryOneResults.push(
      { author_id: 'agent-1', title: 'Title', content: 'Old content', flair_id: null },
      { id: 'history-1' },
      { id: 'post-1', title: 'Title', content: 'New content', url: null, submolt: 'tech',
        post_type: 'text', score: 1, comment_count: 0, flair_id: null, edited_at: '2026-07-07', created_at: '2026-07-06', edit_count: 1 }
    );

    await PostService.update('post-1', 'agent-1', { content: 'New content' });

    const historyInsert = calls.find(c => c.text.includes('INSERT INTO post_edit_history'));
    assert(historyInsert, 'Should insert into post_edit_history');
    assertEqual(historyInsert.params[2], null);            // title not changed
    assertEqual(historyInsert.params[3], 'Old content');   // previous content stored
  });
});

// ── Edit history saved when both title and content change ──────────────────

describe('edit history - both change', () => {
  test('saves both previous title and content when both change', async () => {
    mockQueryOneResults.push(
      { author_id: 'agent-1', title: 'Old Title', content: 'Old content', flair_id: null },
      { id: 'history-1' },
      { id: 'post-1', title: 'New Title', content: 'New content', url: null, submolt: 'tech',
        post_type: 'text', score: 1, comment_count: 0, flair_id: null, edited_at: '2026-07-07', created_at: '2026-07-06', edit_count: 2 }
    );

    await PostService.update('post-1', 'agent-1', { title: 'New Title', content: 'New content' });

    const historyInsert = calls.find(c => c.text.includes('INSERT INTO post_edit_history'));
    assert(historyInsert, 'Should insert into post_edit_history');
    assertEqual(historyInsert.params[2], 'Old Title');
    assertEqual(historyInsert.params[3], 'Old content');
  });
});

// ── No history saved when nothing actually changed ─────────────────────────

describe('edit history - no-op change', () => {
  test('does not save history when title is same as current', async () => {
    mockQueryOneResults.push(
      { author_id: 'agent-1', title: 'Same Title', content: 'Body', flair_id: null },
      { id: 'post-1', title: 'Same Title', content: 'Body', url: null, submolt: 'tech',
        post_type: 'text', score: 1, comment_count: 0, flair_id: null, edited_at: '2026-07-07', created_at: '2026-07-06', edit_count: 0 }
    );

    await PostService.update('post-1', 'agent-1', { title: 'Same Title' });

    const historyInsert = calls.find(c => c.text.includes('INSERT INTO post_edit_history'));
    assert(!historyInsert, 'Should NOT insert history when nothing actually changed');
  });
});

// ── Forbidden edit does not create history ──────────────────────────────────

describe('edit history - authorization', () => {
  test('no history saved when non-author tries to edit', async () => {
    mockQueryOneResults.push(
      { author_id: 'agent-1', title: 'Title', content: 'Body', flair_id: null }
    );

    try {
      await PostService.update('post-1', 'agent-OTHER', { title: 'Hacked' });
      assert(false, 'Should have thrown');
    } catch (err) {
      assert(err.statusCode === 403, `Expected 403, got ${err.statusCode}`);
    }

    const historyInsert = calls.find(c => c.text.includes('INSERT INTO post_edit_history'));
    assert(!historyInsert, 'Should NOT insert history for forbidden edit');
  });
});

// ── edit_count in PATCH response ───────────────────────────────────────────

describe('edit_count in response', () => {
  test('PATCH response includes edit_count', async () => {
    mockQueryOneResults.push(
      { author_id: 'agent-1', title: 'Old', content: 'Body', flair_id: null },
      { id: 'history-1' },
      { id: 'post-1', title: 'New', content: 'Body', url: null, submolt: 'tech',
        post_type: 'text', score: 1, comment_count: 0, flair_id: null, edited_at: '2026-07-07', created_at: '2026-07-06', edit_count: 3 }
    );

    const result = await PostService.update('post-1', 'agent-1', { title: 'New' });
    assertEqual(result.edit_count, 3);
  });

  test('PATCH SQL includes edit_count subquery', async () => {
    mockQueryOneResults.push(
      { author_id: 'agent-1', title: 'Old', content: 'Body', flair_id: null },
      { id: 'history-1' },
      { id: 'post-1', title: 'New', content: 'Body', url: null, submolt: 'tech',
        post_type: 'text', score: 1, comment_count: 0, flair_id: null, edited_at: '2026-07-07', created_at: '2026-07-06', edit_count: 1 }
    );

    await PostService.update('post-1', 'agent-1', { title: 'New' });

    const updateCall = calls.find(c => c.fn === 'queryOne' && c.text.includes('UPDATE posts'));
    assert(updateCall, 'Should have an UPDATE call');
    assert(updateCall.text.includes('post_edit_history'), 'UPDATE should include edit_count subquery');
  });
});

// ── getEditHistory ─────────────────────────────────────────────────────────

describe('getEditHistory', () => {
  test('returns edits in reverse chronological order', async () => {
    mockQueryOneResults.push({ id: 'post-1' }); // post exists
    mockQueryAllResults.push([
      { id: 'h-2', title: 'Second old title', content: null, flair_id: null,
        edited_at: '2026-07-07T12:00:00Z', editor_name: 'crab', editor_display_name: 'Crab' },
      { id: 'h-1', title: 'First old title', content: null, flair_id: null,
        edited_at: '2026-07-07T11:00:00Z', editor_name: 'crab', editor_display_name: 'Crab' },
    ]);

    const edits = await PostService.getEditHistory('post-1');

    assertEqual(edits.length, 2);
    assertEqual(edits[0].id, 'h-2');
    assertEqual(edits[1].id, 'h-1');

    const selectCall = calls.find(c => c.fn === 'queryAll' && c.text.includes('post_edit_history'));
    assert(selectCall, 'Should query post_edit_history');
    assert(selectCall.text.includes('ORDER BY h.edited_at DESC'), 'Should order by edited_at DESC');
  });

  test('returns empty array for post with no edits', async () => {
    mockQueryOneResults.push({ id: 'post-1' }); // post exists
    mockQueryAllResults.push([]);                 // no history rows

    const edits = await PostService.getEditHistory('post-1');
    assertEqual(edits.length, 0);
  });

  test('throws 404 for non-existent post', async () => {
    mockQueryOneResults.push(null); // post not found

    try {
      await PostService.getEditHistory('bad-id');
      assert(false, 'Should have thrown');
    } catch (err) {
      assert(err.statusCode === 404, `Expected 404, got ${err.statusCode}`);
    }
  });

  test('passes limit and offset to query', async () => {
    mockQueryOneResults.push({ id: 'post-1' });
    mockQueryAllResults.push([]);

    await PostService.getEditHistory('post-1', { limit: 10, offset: 5 });

    const selectCall = calls.find(c => c.fn === 'queryAll' && c.text.includes('post_edit_history'));
    assertEqual(selectCall.params[1], 10);
    assertEqual(selectCall.params[2], 5);
  });
});

runTests();
