/**
 * Flairs Test Suite
 *
 * Run: node test/flairs.test.js
 */

// Mock database before requiring services
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
    transaction: async (callback) => {
      return callback({
        query: async (text, params) => {
          calls.push({ fn: 'transaction.query', text, params });
          return { rows: [], rowCount: 0 };
        }
      });
    }
  }
};

const FlairService = require('../src/services/FlairService');

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
  console.log('\nFlairs Test Suite\n');
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

// ── Flair CRUD Tests ────────────────────────────────────────────

describe('FlairService.create', () => {
  test('creates a flair successfully', async () => {
    // Mock: count query returns 0 flairs, then insert succeeds
    mockQueryOneResults.push({ count: 0 });
    mockQueryOneResults.push({
      id: 'flair-1',
      submolt_id: 'sub-1',
      name: 'Discussion',
      color: '#ff0000',
      display_order: 0,
      created_at: '2026-01-01'
    });

    const flair = await FlairService.create('sub-1', {
      name: 'Discussion',
      color: '#ff0000',
      displayOrder: 0
    });

    assertEqual(flair.name, 'Discussion');
    assertEqual(flair.color, '#ff0000');
    assert(calls[1].text.includes('INSERT INTO submolt_flairs'));
  });

  test('rejects empty name', async () => {
    try {
      await FlairService.create('sub-1', { name: '' });
      assert(false, 'Should have thrown');
    } catch (err) {
      assert(err.statusCode === 400);
      assert(err.message.includes('required'));
    }
  });

  test('rejects name over 30 characters', async () => {
    try {
      await FlairService.create('sub-1', { name: 'a'.repeat(31) });
      assert(false, 'Should have thrown');
    } catch (err) {
      assert(err.statusCode === 400);
      assert(err.message.includes('30 characters'));
    }
  });

  test('rejects invalid color format', async () => {
    try {
      await FlairService.create('sub-1', { name: 'Test', color: 'red' });
      assert(false, 'Should have thrown');
    } catch (err) {
      assert(err.statusCode === 400);
      assert(err.message.includes('hex color'));
    }
  });

  test('enforces max 20 flairs per submolt', async () => {
    mockQueryOneResults.push({ count: 20 });

    try {
      await FlairService.create('sub-1', { name: 'TooMany' });
      assert(false, 'Should have thrown');
    } catch (err) {
      assert(err.statusCode === 400);
      assert(err.code === 'FLAIR_LIMIT');
    }
  });

  test('rejects duplicate flair name in same submolt', async () => {
    mockQueryOneResults.push({ count: 5 });
    const dupErr = new Error('duplicate key');
    dupErr.code = '23505';
    mockQueryOneResults.push(new MockError(dupErr));

    try {
      await FlairService.create('sub-1', { name: 'Existing' });
      assert(false, 'Should have thrown');
    } catch (err) {
      assert(err.statusCode === 400);
      assert(err.code === 'DUPLICATE_FLAIR');
    }
  });
});

describe('FlairService.list', () => {
  test('returns all flairs ordered by display_order', async () => {
    mockQueryAllResults.push([
      { id: 'f1', name: 'Discussion', color: '#ff0000', display_order: 0, created_at: '2026-01-01' },
      { id: 'f2', name: 'Question', color: '#00ff00', display_order: 1, created_at: '2026-01-02' }
    ]);

    const flairs = await FlairService.list('sub-1');
    assertEqual(flairs.length, 2);
    assertEqual(flairs[0].name, 'Discussion');
    assertEqual(flairs[1].name, 'Question');
    assert(calls[0].text.includes('ORDER BY display_order'));
  });

  test('returns empty array when no flairs exist', async () => {
    const flairs = await FlairService.list('sub-1');
    assertEqual(flairs, []);
  });
});

describe('FlairService.getById', () => {
  test('returns a flair by ID', async () => {
    mockQueryOneResults.push({
      id: 'flair-1', submolt_id: 'sub-1', name: 'Test',
      color: '#aabbcc', display_order: 0, created_at: '2026-01-01'
    });

    const flair = await FlairService.getById('flair-1');
    assertEqual(flair.name, 'Test');
  });

  test('throws NotFoundError when flair does not exist', async () => {
    try {
      await FlairService.getById('nonexistent');
      assert(false, 'Should have thrown');
    } catch (err) {
      assert(err.statusCode === 404);
    }
  });
});

describe('FlairService.update', () => {
  test('updates flair name and color', async () => {
    mockQueryOneResults.push({ id: 'flair-1', submolt_id: 'sub-1' });
    mockQueryOneResults.push({
      id: 'flair-1', submolt_id: 'sub-1', name: 'Updated',
      color: '#000000', display_order: 0, created_at: '2026-01-01'
    });

    const flair = await FlairService.update('flair-1', {
      name: 'Updated',
      color: '#000000'
    });

    assertEqual(flair.name, 'Updated');
    assert(calls[1].text.includes('UPDATE submolt_flairs'));
  });

  test('throws NotFoundError for nonexistent flair', async () => {
    try {
      await FlairService.update('nonexistent', { name: 'X' });
      assert(false, 'Should have thrown');
    } catch (err) {
      assert(err.statusCode === 404);
    }
  });

  test('rejects empty name', async () => {
    mockQueryOneResults.push({ id: 'flair-1', submolt_id: 'sub-1' });

    try {
      await FlairService.update('flair-1', { name: '   ' });
      assert(false, 'Should have thrown');
    } catch (err) {
      assert(err.statusCode === 400);
    }
  });

  test('throws BadRequestError when no fields provided', async () => {
    mockQueryOneResults.push({ id: 'flair-1', submolt_id: 'sub-1' });

    try {
      await FlairService.update('flair-1', {});
      assert(false, 'Should have thrown');
    } catch (err) {
      assert(err.statusCode === 400);
      assert(err.message.includes('No fields'));
    }
  });
});

describe('FlairService.delete', () => {
  test('deletes a flair and nullifies post flair_id', async () => {
    mockQueryOneResults.push({ id: 'flair-1' }); // exists check
    mockQueryOneResults.push(null); // UPDATE posts SET flair_id = NULL
    mockQueryOneResults.push(null); // DELETE

    await FlairService.delete('flair-1');

    // Verify nullification query was called
    assert(calls[1].text.includes('UPDATE posts SET flair_id = NULL'));
    assert(calls[1].params[0] === 'flair-1');
    // Verify delete query
    assert(calls[2].text.includes('DELETE FROM submolt_flairs'));
  });

  test('throws NotFoundError for nonexistent flair', async () => {
    try {
      await FlairService.delete('nonexistent');
      assert(false, 'Should have thrown');
    } catch (err) {
      assert(err.statusCode === 404);
    }
  });
});

// ── Post with Flair Tests ───────────────────────────────────────

describe('FlairService.validateForSubmolt', () => {
  test('returns flair when it belongs to the submolt', async () => {
    mockQueryOneResults.push({
      id: 'flair-1', submolt_id: 'sub-1', name: 'Test', color: '#ff0000'
    });

    const flair = await FlairService.validateForSubmolt('flair-1', 'sub-1');
    assertEqual(flair.name, 'Test');
  });

  test('throws NotFoundError when flair does not exist', async () => {
    try {
      await FlairService.validateForSubmolt('nonexistent', 'sub-1');
      assert(false, 'Should have thrown');
    } catch (err) {
      assert(err.statusCode === 404);
    }
  });

  test('throws BadRequestError when flair belongs to different submolt', async () => {
    mockQueryOneResults.push({
      id: 'flair-1', submolt_id: 'sub-2', name: 'Test', color: '#ff0000'
    });

    try {
      await FlairService.validateForSubmolt('flair-1', 'sub-1');
      assert(false, 'Should have thrown');
    } catch (err) {
      assert(err.statusCode === 400);
      assert(err.code === 'INVALID_FLAIR');
    }
  });
});

// ── Post creation/update with flair (via PostService) ───────────

describe('PostService with flairs', () => {
  // Clear module cache so PostService picks up our mocked database
  const PostService = require('../src/services/PostService');

  test('creates a post with a valid flair', async () => {
    // submolt lookup
    mockQueryOneResults.push({ id: 'sub-1' });
    // FlairService.validateForSubmolt: flair lookup
    mockQueryOneResults.push({ id: 'flair-1', submolt_id: 'sub-1', name: 'Discussion', color: '#ff0000' });
    // INSERT post
    mockQueryOneResults.push({
      id: 'post-1', title: 'Test', content: 'Body', url: null,
      submolt: 'testmolt', post_type: 'text', score: 1, comment_count: 0,
      flair_id: 'flair-1', created_at: '2026-01-01'
    });
    // submolt post_count update
    mockQueryOneResults.push(null);

    const post = await PostService.create({
      authorId: 'agent-1',
      submolt: 'testmolt',
      title: 'Test',
      content: 'Body',
      flairId: 'flair-1'
    });

    assertEqual(post.flair.id, 'flair-1');
    assertEqual(post.flair.name, 'Discussion');
    // Verify the INSERT included flair_id
    const insertCall = calls.find(c => c.text.includes('INSERT INTO posts'));
    assert(insertCall, 'Should have INSERT INTO posts call');
    assert(insertCall.text.includes('flair_id'));
  });

  test('creates a post without flair (flair is null)', async () => {
    // submolt lookup
    mockQueryOneResults.push({ id: 'sub-1' });
    // INSERT post (no flair validation needed)
    mockQueryOneResults.push({
      id: 'post-2', title: 'No flair', content: 'Body', url: null,
      submolt: 'testmolt', post_type: 'text', score: 1, comment_count: 0,
      flair_id: null, created_at: '2026-01-01'
    });
    // submolt post_count update
    mockQueryOneResults.push(null);

    const post = await PostService.create({
      authorId: 'agent-1',
      submolt: 'testmolt',
      title: 'No flair',
      content: 'Body'
    });

    assertEqual(post.flair, null);
  });

  test('rejects post creation with flair from wrong submolt', async () => {
    // submolt lookup
    mockQueryOneResults.push({ id: 'sub-1' });
    // FlairService.validateForSubmolt: flair from different submolt
    mockQueryOneResults.push({ id: 'flair-1', submolt_id: 'sub-2', name: 'Other', color: null });

    try {
      await PostService.create({
        authorId: 'agent-1',
        submolt: 'testmolt',
        title: 'Test',
        content: 'Body',
        flairId: 'flair-1'
      });
      assert(false, 'Should have thrown');
    } catch (err) {
      assert(err.statusCode === 400);
      assert(err.code === 'INVALID_FLAIR');
    }
  });

  test('rejects post creation with nonexistent flair', async () => {
    // submolt lookup
    mockQueryOneResults.push({ id: 'sub-1' });
    // FlairService.validateForSubmolt: flair not found (queryOne returns null)

    try {
      await PostService.create({
        authorId: 'agent-1',
        submolt: 'testmolt',
        title: 'Test',
        content: 'Body',
        flairId: 'nonexistent'
      });
      assert(false, 'Should have thrown');
    } catch (err) {
      assert(err.statusCode === 404);
    }
  });

  test('updates post to add flair', async () => {
    // author check
    mockQueryOneResults.push({ author_id: 'agent-1' });
    // submolt_id lookup for flair validation
    mockQueryOneResults.push({ submolt_id: 'sub-1' });
    // FlairService.validateForSubmolt: flair lookup
    mockQueryOneResults.push({ id: 'flair-1', submolt_id: 'sub-1', name: 'News', color: '#0000ff' });
    // UPDATE post
    mockQueryOneResults.push({
      id: 'post-1', title: 'Updated', content: 'Body', url: null,
      submolt: 'testmolt', post_type: 'text', score: 1, comment_count: 0,
      flair_id: 'flair-1', edited_at: '2026-01-02', created_at: '2026-01-01'
    });

    const post = await PostService.update('post-1', 'agent-1', {
      flairId: 'flair-1'
    });

    const updateCall = calls.find(c => c.text.includes('UPDATE posts SET'));
    assert(updateCall, 'Should have UPDATE posts call');
    assert(updateCall.text.includes('flair_id'));
  });

  test('updates post to remove flair (set null)', async () => {
    // author check
    mockQueryOneResults.push({ author_id: 'agent-1' });
    // UPDATE post
    mockQueryOneResults.push({
      id: 'post-1', title: 'Updated', content: 'Body', url: null,
      submolt: 'testmolt', post_type: 'text', score: 1, comment_count: 0,
      flair_id: null, edited_at: '2026-01-02', created_at: '2026-01-01'
    });

    const post = await PostService.update('post-1', 'agent-1', {
      flairId: null
    });

    const updateCall = calls.find(c => c.text.includes('UPDATE posts SET'));
    assert(updateCall, 'Should have UPDATE posts call');
    assert(updateCall.text.includes('flair_id = NULL'));
  });
});

// ── Feed filtering by flair ─────────────────────────────────────

describe('Feed filtering by flair', () => {
  const PostService = require('../src/services/PostService');

  test('getFeed with flair ID filter includes flair WHERE clause', async () => {
    mockQueryAllResults.push([]);

    await PostService.getFeed({
      sort: 'new',
      limit: 25,
      offset: 0,
      flair: '12345678-1234-1234-1234-123456789abc'
    });

    const queryCall = calls.find(c => c.fn === 'queryAll');
    assert(queryCall, 'Should have queryAll call');
    assert(queryCall.text.includes('p.flair_id = $'), 'Should filter by flair_id');
    assert(queryCall.params.includes('12345678-1234-1234-1234-123456789abc'));
  });

  test('getFeed with flair name filter uses subquery', async () => {
    mockQueryAllResults.push([]);

    await PostService.getFeed({
      sort: 'new',
      limit: 25,
      offset: 0,
      flair: 'Discussion'
    });

    const queryCall = calls.find(c => c.fn === 'queryAll');
    assert(queryCall, 'Should have queryAll call');
    assert(queryCall.text.includes('submolt_flairs'), 'Should join/subquery submolt_flairs');
    assert(queryCall.params.includes('Discussion'));
  });

  test('getFeed without flair filter does not include flair WHERE clause', async () => {
    mockQueryAllResults.push([]);

    await PostService.getFeed({
      sort: 'new',
      limit: 25,
      offset: 0
    });

    const queryCall = calls.find(c => c.fn === 'queryAll');
    assert(queryCall, 'Should have queryAll call');
    assert(!queryCall.text.includes('p.flair_id = $'), 'Should not filter by flair_id');
  });

  test('getFeed returns posts with flair object', async () => {
    mockQueryAllResults.push([
      {
        id: 'post-1', title: 'Test', content: 'Body', url: null,
        submolt: 'testmolt', post_type: 'text', score: 1, comment_count: 0,
        created_at: '2026-01-01', flair_id: 'flair-1',
        author_name: 'bot', author_display_name: 'Bot',
        reaction_counts: '{}', bookmark_count: 0,
        flair_id_ref: 'flair-1', flair_name: 'Discussion', flair_color: '#ff0000'
      }
    ]);

    const posts = await PostService.getFeed({ sort: 'new', limit: 25, offset: 0 });

    assertEqual(posts.length, 1);
    assertEqual(posts[0].flair.id, 'flair-1');
    assertEqual(posts[0].flair.name, 'Discussion');
    assertEqual(posts[0].flair.color, '#ff0000');
    // Should not have raw flair fields
    assert(posts[0].flair_id_ref === undefined);
    assert(posts[0].flair_name === undefined);
  });

  test('getFeed returns null flair for posts without flair', async () => {
    mockQueryAllResults.push([
      {
        id: 'post-2', title: 'No flair', content: 'Body', url: null,
        submolt: 'testmolt', post_type: 'text', score: 1, comment_count: 0,
        created_at: '2026-01-01', flair_id: null,
        author_name: 'bot', author_display_name: 'Bot',
        reaction_counts: '{}', bookmark_count: 0,
        flair_id_ref: null, flair_name: null, flair_color: null
      }
    ]);

    const posts = await PostService.getFeed({ sort: 'new', limit: 25, offset: 0 });

    assertEqual(posts.length, 1);
    assertEqual(posts[0].flair, null);
  });
});

// Run
runTests();
