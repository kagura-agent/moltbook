/**
 * Post Media Test Suite
 *
 * Run: node test/post-media.test.js
 */

// Mock database before requiring service
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
    }
  }
};

const PostMediaService = require('../src/services/PostMediaService');

// Test framework
let passed = 0;
let failed = 0;

function reset() {
  calls.length = 0;
  mockQueryOneResults = [];
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
  console.log('PostMediaService tests:\n');

  // --- addMedia ---
  await test('addMedia: inserts valid media items', async () => {
    mockQueryOneResults = [
      { id: 'post-1', author_id: 'agent-1' },   // post exists check
      { count: 0 },                               // existing count check (queryOne COUNT)
      { id: 'm-1', post_id: 'post-1', media_url: 'https://img.example.com/a.png', media_type: 'image', alt_text: null, position: 0 },
      { id: 'm-2', post_id: 'post-1', media_url: 'https://img.example.com/b.gif', media_type: 'gif', alt_text: 'A gif', position: 1 }
    ];

    const result = await PostMediaService.addMedia('post-1', [
      { url: 'https://img.example.com/a.png' },
      { url: 'https://img.example.com/b.gif', type: 'gif', altText: 'A gif', position: 1 }
    ]);

    assertEqual(result.length, 2);
    assert(calls[0].text.includes('SELECT id'), 'should check post exists');
    assert(calls[1].text.includes('COUNT'), 'should count existing media');
    assert(calls[2].text.includes('INSERT INTO post_media'), 'should insert first media');
    assert(calls[2].text.includes('ON CONFLICT'), 'should use ON CONFLICT');
    assertEqual(calls[2].params[0], 'post-1', 'should pass post_id');
    assertEqual(calls[2].params[1], 'https://img.example.com/a.png', 'should pass media_url');
    assertEqual(calls[2].params[2], 'image', 'should default to image type');
    assert(calls[3].text.includes('INSERT INTO post_media'), 'should insert second media');
    assertEqual(calls[3].params[2], 'gif', 'should pass gif type');
    assertEqual(calls[3].params[3], 'A gif', 'should pass alt text');
  });

  await test('addMedia: rejects invalid URLs', async () => {
    mockQueryOneResults = [
      { id: 'post-1', author_id: 'agent-1' },
      { count: 0 }
    ];

    try {
      await PostMediaService.addMedia('post-1', [{ url: 'not-a-url' }]);
      throw new Error('Should have thrown');
    } catch (err) {
      assertEqual(err.constructor.name, 'BadRequestError');
      assert(err.message.includes('invalid URL'), 'should mention invalid URL');
    }
  });

  await test('addMedia: enforces max 10 items per post', async () => {
    mockQueryOneResults = [
      { id: 'post-1', author_id: 'agent-1' },
      { count: 0 }
    ];

    const items = Array.from({ length: 11 }, (_, i) => ({ url: `https://example.com/${i}.png` }));
    try {
      await PostMediaService.addMedia('post-1', items);
      throw new Error('Should have thrown');
    } catch (err) {
      assertEqual(err.constructor.name, 'BadRequestError');
      assert(err.message.includes('10'), 'should mention max limit');
    }
  });

  await test('addMedia: enforces max 10 items including existing', async () => {
    mockQueryOneResults = [
      { id: 'post-1', author_id: 'agent-1' },
      { count: 8 }
    ];

    try {
      await PostMediaService.addMedia('post-1', [
        { url: 'https://example.com/a.png' },
        { url: 'https://example.com/b.png' },
        { url: 'https://example.com/c.png' }
      ]);
      throw new Error('Should have thrown');
    } catch (err) {
      assertEqual(err.constructor.name, 'BadRequestError');
      assert(err.message.includes('10'), 'should mention max limit');
    }
  });

  await test('addMedia: skips duplicate URLs via ON CONFLICT DO NOTHING', async () => {
    mockQueryOneResults = [
      { id: 'post-1', author_id: 'agent-1' },
      { count: 0 },
      null  // INSERT returns null (ON CONFLICT DO NOTHING — duplicate)
    ];

    const result = await PostMediaService.addMedia('post-1', [
      { url: 'https://img.example.com/dup.png' }
    ]);

    assertEqual(result.length, 0, 'should not include duplicate');
    assert(calls[2].text.includes('ON CONFLICT'), 'should use ON CONFLICT');
  });

  await test('addMedia: validates media type (only image/gif/video)', async () => {
    mockQueryOneResults = [
      { id: 'post-1', author_id: 'agent-1' },
      { count: 0 }
    ];

    try {
      await PostMediaService.addMedia('post-1', [{ url: 'https://example.com/a.mp3', type: 'audio' }]);
      throw new Error('Should have thrown');
    } catch (err) {
      assertEqual(err.constructor.name, 'BadRequestError');
      assert(err.message.includes("invalid type"), 'should mention invalid type');
    }
  });

  await test('addMedia: validates URL length (max 2048)', async () => {
    mockQueryOneResults = [
      { id: 'post-1', author_id: 'agent-1' },
      { count: 0 }
    ];

    const longUrl = 'https://example.com/' + 'a'.repeat(2040);
    try {
      await PostMediaService.addMedia('post-1', [{ url: longUrl }]);
      throw new Error('Should have thrown');
    } catch (err) {
      assertEqual(err.constructor.name, 'BadRequestError');
      assert(err.message.includes('2048 characters'), 'should mention max URL length');
    }
  });

  await test('addMedia: validates alt text length (max 500)', async () => {
    mockQueryOneResults = [
      { id: 'post-1', author_id: 'agent-1' },
      { count: 0 }
    ];

    try {
      await PostMediaService.addMedia('post-1', [
        { url: 'https://example.com/a.png', altText: 'x'.repeat(501) }
      ]);
      throw new Error('Should have thrown');
    } catch (err) {
      assertEqual(err.constructor.name, 'BadRequestError');
      assert(err.message.includes('500 characters'), 'should mention max alt text length');
    }
  });

  await test('addMedia: throws NotFoundError if post does not exist', async () => {
    mockQueryOneResults = [null];

    try {
      await PostMediaService.addMedia('nonexistent', [{ url: 'https://example.com/a.png' }]);
      throw new Error('Should have thrown');
    } catch (err) {
      assertEqual(err.constructor.name, 'NotFoundError');
    }
  });

  await test('addMedia: rejects empty media array', async () => {
    try {
      await PostMediaService.addMedia('post-1', []);
      throw new Error('Should have thrown');
    } catch (err) {
      assertEqual(err.constructor.name, 'BadRequestError');
      assert(err.message.includes('required'), 'should mention media required');
    }
  });

  await test('addMedia: rejects non-array media', async () => {
    try {
      await PostMediaService.addMedia('post-1', 'not-an-array');
      throw new Error('Should have thrown');
    } catch (err) {
      assertEqual(err.constructor.name, 'BadRequestError');
    }
  });

  // --- getMedia ---
  await test('getMedia: returns media ordered by position', async () => {
    const mockMedia = [
      { id: 'm-1', post_id: 'post-1', media_url: 'https://example.com/a.png', media_type: 'image', alt_text: null, position: 0 },
      { id: 'm-2', post_id: 'post-1', media_url: 'https://example.com/b.gif', media_type: 'gif', alt_text: 'B', position: 1 }
    ];
    mockQueryAllResults = [mockMedia];

    const result = await PostMediaService.getMedia('post-1');
    assertEqual(result.length, 2);
    assertEqual(result[0].id, 'm-1');
    assertEqual(result[1].id, 'm-2');
    assert(calls[0].text.includes('FROM post_media'), 'should query post_media');
    assert(calls[0].text.includes('ORDER BY position ASC'), 'should order by position');
    assertEqual(calls[0].params[0], 'post-1');
  });

  await test('getMedia: returns empty array when no media', async () => {
    mockQueryAllResults = [[]];

    const result = await PostMediaService.getMedia('post-1');
    assertEqual(result.length, 0);
  });

  // --- removeMedia ---
  await test('removeMedia: deletes specific media item via DELETE RETURNING', async () => {
    mockQueryOneResults = [{ id: 'm-1' }];  // DELETE RETURNING result

    const result = await PostMediaService.removeMedia('post-1', 'm-1');
    assertEqual(calls.length, 1);
    assert(calls[0].text.includes('DELETE FROM post_media'), 'should delete media');
    assert(calls[0].text.includes('RETURNING'), 'should use RETURNING');
    assertEqual(calls[0].params[0], 'm-1', 'should pass media ID');
    assertEqual(calls[0].params[1], 'post-1', 'should pass post ID');
    assertEqual(result.id, 'm-1');
  });

  await test('removeMedia: throws NotFoundError if media does not exist', async () => {
    mockQueryOneResults = [null];

    try {
      await PostMediaService.removeMedia('post-1', 'nonexistent');
      throw new Error('Should have thrown');
    } catch (err) {
      assertEqual(err.constructor.name, 'NotFoundError');
    }
  });

  // --- removeAllMedia ---
  await test('removeAllMedia: clears all media for a post', async () => {
    mockQueryOneResults = [null]; // DELETE result

    await PostMediaService.removeAllMedia('post-1');
    assertEqual(calls.length, 1);
    assert(calls[0].text.includes('DELETE FROM post_media'), 'should delete all media');
    assert(calls[0].text.includes('post_id'), 'should filter by post_id');
    assertEqual(calls[0].params[0], 'post-1');
  });

  // --- getMediaForPosts ---
  await test('getMediaForPosts: batch-fetches and groups by post_id', async () => {
    mockQueryAllResults = [[
      { id: 'm-1', post_id: 'p-1', media_url: 'https://example.com/1.png', media_type: 'image', alt_text: null, position: 0 },
      { id: 'm-2', post_id: 'p-1', media_url: 'https://example.com/2.png', media_type: 'image', alt_text: null, position: 1 },
      { id: 'm-3', post_id: 'p-2', media_url: 'https://example.com/3.gif', media_type: 'gif', alt_text: 'A gif', position: 0 }
    ]];

    const result = await PostMediaService.getMediaForPosts(['p-1', 'p-2', 'p-3']);
    assert(result instanceof Map, 'should return a Map');
    assertEqual(result.get('p-1').length, 2, 'p-1 should have 2 media');
    assertEqual(result.get('p-2').length, 1, 'p-2 should have 1 media');
    assertEqual(result.has('p-3'), false, 'p-3 should have no media');
    assert(calls[0].text.includes('ANY($1)'), 'should use ANY for batch fetch');
  });

  await test('getMediaForPosts: returns empty map for empty input', async () => {
    const result = await PostMediaService.getMediaForPosts([]);
    assert(result instanceof Map, 'should return a Map');
    assertEqual(result.size, 0, 'should be empty');
    assertEqual(calls.length, 0, 'should not query database');
  });

  // Summary
  console.log(`\n${passed + failed} tests, ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})();
