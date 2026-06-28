/**
 * Series Test Suite
 *
 * Run: node test/series.test.js
 */

// Mock database before requiring service
const calls = [];
let mockQueryOneResults = [];
let mockQueryAllResults = [];
let mockTransactionFn = null;

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
      calls.push({ fn: 'transaction' });
      const mockClient = {
        query: async (text, params) => {
          calls.push({ fn: 'client.query', text, params });
        }
      };
      if (mockTransactionFn) return mockTransactionFn(mockClient);
      return callback(mockClient);
    }
  }
};

const SeriesService = require('../src/services/SeriesService');

// Test framework
let passed = 0;
let failed = 0;

function reset() {
  calls.length = 0;
  mockQueryOneResults = [];
  mockQueryAllResults = [];
  mockTransactionFn = null;
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
  console.log('SeriesService tests:\n');

  // --- create ---
  await test('create: creates a series successfully', async () => {
    mockQueryOneResults = [
      { count: 0 },  // series count check
      { id: 's-1', agent_id: 'a-1', title: 'My Series', description: null, created_at: '2026-01-01', updated_at: '2026-01-01' }
    ];

    const result = await SeriesService.create('a-1', { title: 'My Series' });
    assertEqual(result.title, 'My Series');
    assert(calls[0].text.includes('COUNT'), 'should check count');
    assert(calls[1].text.includes('INSERT INTO series'), 'should insert');
  });

  await test('create: throws if title is missing', async () => {
    try {
      await SeriesService.create('a-1', { title: '' });
      throw new Error('Should have thrown');
    } catch (err) {
      assertEqual(err.constructor.name, 'BadRequestError');
    }
  });

  await test('create: throws if title exceeds 200 chars', async () => {
    try {
      await SeriesService.create('a-1', { title: 'x'.repeat(201) });
      throw new Error('Should have thrown');
    } catch (err) {
      assertEqual(err.constructor.name, 'BadRequestError');
      assert(err.message.includes('200'), 'should mention limit');
    }
  });

  await test('create: throws if series limit reached (20)', async () => {
    mockQueryOneResults = [{ count: 20 }];

    try {
      await SeriesService.create('a-1', { title: 'Another Series' });
      throw new Error('Should have thrown');
    } catch (err) {
      assertEqual(err.constructor.name, 'BadRequestError');
      assert(err.message.includes('20'), 'should mention limit');
    }
  });

  // --- list ---
  await test('list: returns series with post counts', async () => {
    mockQueryAllResults = [[
      { id: 's-1', title: 'Series 1', post_count: 3 },
      { id: 's-2', title: 'Series 2', post_count: 0 }
    ]];

    const result = await SeriesService.list('a-1');
    assertEqual(result.length, 2);
    assertEqual(result[0].post_count, 3);
    assert(calls[0].text.includes('FROM series'), 'should query series');
    assertEqual(calls[0].params[0], 'a-1');
  });

  await test('list: passes pagination params', async () => {
    mockQueryAllResults = [[]];

    await SeriesService.list('a-1', { limit: 10, offset: 5 });
    assertEqual(calls[0].params[1], 10);
    assertEqual(calls[0].params[2], 5);
  });

  // --- getById ---
  await test('getById: returns series with posts', async () => {
    mockQueryOneResults = [
      { id: 's-1', agent_id: 'a-1', title: 'Test', description: 'desc', agent_name: 'bob' }
    ];
    mockQueryAllResults = [[
      { id: 'p-1', title: 'Post 1', position: 0 },
      { id: 'p-2', title: 'Post 2', position: 1 }
    ]];

    const result = await SeriesService.getById('s-1');
    assertEqual(result.title, 'Test');
    assertEqual(result.posts.length, 2);
    assertEqual(result.posts[0].position, 0);
  });

  await test('getById: throws NotFoundError if not found', async () => {
    mockQueryOneResults = [null];

    try {
      await SeriesService.getById('nonexistent');
      throw new Error('Should have thrown');
    } catch (err) {
      assertEqual(err.constructor.name, 'NotFoundError');
    }
  });

  // --- update ---
  await test('update: updates title and description', async () => {
    mockQueryOneResults = [
      { id: 's-1', agent_id: 'a-1' },  // ownership check
      { id: 's-1', agent_id: 'a-1', title: 'New Title', description: 'New desc', created_at: '2026-01-01', updated_at: '2026-01-02' }
    ];

    const result = await SeriesService.update('a-1', 's-1', { title: 'New Title', description: 'New desc' });
    assertEqual(result.title, 'New Title');
    assert(calls[1].text.includes('UPDATE series'), 'should update');
  });

  await test('update: throws ForbiddenError if not owner', async () => {
    mockQueryOneResults = [{ id: 's-1', agent_id: 'other-agent' }];

    try {
      await SeriesService.update('a-1', 's-1', { title: 'Hack' });
      throw new Error('Should have thrown');
    } catch (err) {
      assertEqual(err.constructor.name, 'ForbiddenError');
    }
  });

  await test('update: throws NotFoundError if series missing', async () => {
    mockQueryOneResults = [null];

    try {
      await SeriesService.update('a-1', 's-1', { title: 'x' });
      throw new Error('Should have thrown');
    } catch (err) {
      assertEqual(err.constructor.name, 'NotFoundError');
    }
  });

  // --- delete ---
  await test('delete: deletes own series', async () => {
    mockQueryOneResults = [
      { id: 's-1', agent_id: 'a-1' },  // ownership check
      { id: 's-1' }                      // delete result
    ];

    const result = await SeriesService.delete('a-1', 's-1');
    assertEqual(result.action, 'deleted');
    assert(calls[1].text.includes('DELETE FROM series'), 'should delete');
  });

  await test('delete: throws ForbiddenError if not owner', async () => {
    mockQueryOneResults = [{ id: 's-1', agent_id: 'other-agent' }];

    try {
      await SeriesService.delete('a-1', 's-1');
      throw new Error('Should have thrown');
    } catch (err) {
      assertEqual(err.constructor.name, 'ForbiddenError');
    }
  });

  // --- addPost ---
  await test('addPost: adds a post to series', async () => {
    mockQueryOneResults = [
      { id: 's-1', agent_id: 'a-1' },  // series check
      { id: 'p-1' },                     // post exists
      { count: 5 },                      // post count
      null,                               // not already in series
      { max_pos: 4 },                    // max position
      { series_id: 's-1' },             // insert result
      { id: 's-1' }                      // update timestamp
    ];

    const result = await SeriesService.addPost('a-1', 's-1', 'p-1');
    assertEqual(result.action, 'added');
  });

  await test('addPost: returns already_in_series if duplicate', async () => {
    mockQueryOneResults = [
      { id: 's-1', agent_id: 'a-1' },  // series check
      { id: 'p-1' },                     // post exists
      { count: 5 },                      // post count
      { series_id: 's-1' }              // already exists
    ];

    const result = await SeriesService.addPost('a-1', 's-1', 'p-1');
    assertEqual(result.action, 'already_in_series');
  });

  await test('addPost: throws if post limit reached (50)', async () => {
    mockQueryOneResults = [
      { id: 's-1', agent_id: 'a-1' },
      { id: 'p-1' },
      { count: 50 }  // at limit
    ];

    try {
      await SeriesService.addPost('a-1', 's-1', 'p-1');
      throw new Error('Should have thrown');
    } catch (err) {
      assertEqual(err.constructor.name, 'BadRequestError');
      assert(err.message.includes('50'), 'should mention limit');
    }
  });

  await test('addPost: throws NotFoundError if post does not exist', async () => {
    mockQueryOneResults = [
      { id: 's-1', agent_id: 'a-1' },
      null  // post not found
    ];

    try {
      await SeriesService.addPost('a-1', 's-1', 'nonexistent');
      throw new Error('Should have thrown');
    } catch (err) {
      assertEqual(err.constructor.name, 'NotFoundError');
    }
  });

  await test('addPost: throws ForbiddenError if not series owner', async () => {
    mockQueryOneResults = [{ id: 's-1', agent_id: 'other-agent' }];

    try {
      await SeriesService.addPost('a-1', 's-1', 'p-1');
      throw new Error('Should have thrown');
    } catch (err) {
      assertEqual(err.constructor.name, 'ForbiddenError');
    }
  });

  // --- removePost ---
  await test('removePost: removes a post from series', async () => {
    mockQueryOneResults = [
      { id: 's-1', agent_id: 'a-1' },  // ownership check
      { series_id: 's-1' },             // delete result
      { id: 's-1' }                      // update timestamp
    ];

    const result = await SeriesService.removePost('a-1', 's-1', 'p-1');
    assertEqual(result.action, 'removed');
    assert(calls[1].text.includes('DELETE FROM series_posts'), 'should delete');
  });

  await test('removePost: returns not_in_series if not found', async () => {
    mockQueryOneResults = [
      { id: 's-1', agent_id: 'a-1' },
      null  // not in series
    ];

    const result = await SeriesService.removePost('a-1', 's-1', 'p-1');
    assertEqual(result.action, 'not_in_series');
  });

  // --- reorder ---
  await test('reorder: reorders posts in a series', async () => {
    mockQueryOneResults = [
      { id: 's-1', agent_id: 'a-1' },  // ownership check
      { id: 's-1' }                      // update timestamp
    ];

    const result = await SeriesService.reorder('a-1', 's-1', ['p-2', 'p-1', 'p-3']);
    assertEqual(result.action, 'reordered');
    // Verify transaction was called
    assert(calls.some(c => c.fn === 'transaction'), 'should use transaction');
    // Verify position updates
    const posUpdates = calls.filter(c => c.fn === 'client.query');
    assertEqual(posUpdates.length, 3, 'should update 3 positions');
    assertEqual(posUpdates[0].params[0], 0, 'first position should be 0');
    assertEqual(posUpdates[0].params[2], 'p-2', 'first should be p-2');
    assertEqual(posUpdates[1].params[0], 1, 'second position should be 1');
    assertEqual(posUpdates[2].params[0], 2, 'third position should be 2');
  });

  await test('reorder: throws if postIds is empty', async () => {
    mockQueryOneResults = [{ id: 's-1', agent_id: 'a-1' }];

    try {
      await SeriesService.reorder('a-1', 's-1', []);
      throw new Error('Should have thrown');
    } catch (err) {
      assertEqual(err.constructor.name, 'BadRequestError');
    }
  });

  await test('reorder: throws ForbiddenError if not owner', async () => {
    mockQueryOneResults = [{ id: 's-1', agent_id: 'other-agent' }];

    try {
      await SeriesService.reorder('a-1', 's-1', ['p-1']);
      throw new Error('Should have thrown');
    } catch (err) {
      assertEqual(err.constructor.name, 'ForbiddenError');
    }
  });

  // Summary
  console.log(`\n${passed + failed} tests, ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})();
