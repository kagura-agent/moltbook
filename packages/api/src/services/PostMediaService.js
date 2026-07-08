/**
 * Post Media Service
 * Handles media (image/gif/video URL) attachments on posts
 */

const { queryOne, queryAll } = require('../config/database');
const { BadRequestError, NotFoundError } = require('../utils/errors');

const VALID_MEDIA_TYPES = ['image', 'gif', 'video'];
const MAX_MEDIA_PER_POST = 10;
const MAX_URL_LENGTH = 2048;
const MAX_ALT_TEXT_LENGTH = 500;

class PostMediaService {
  /**
   * Add media items to a post (bulk insert)
   *
   * @param {string} postId - Post UUID
   * @param {Array<{url: string, type?: string, altText?: string, position?: number}>} items
   * @returns {Promise<Object[]>} Created media rows
   */
  static async addMedia(postId, items) {
    if (!Array.isArray(items) || items.length === 0) {
      throw new BadRequestError(
        'Media items array is required',
        'BAD_REQUEST',
        'Provide a non-empty array of media items with at least a url field'
      );
    }

    // Check post exists
    const post = await queryOne('SELECT id, author_id FROM posts WHERE id = $1', [postId]);
    if (!post) {
      throw new NotFoundError('Post', 'Check the post ID or browse posts at GET /api/v1/posts');
    }

    // Check existing count
    const existing = await queryOne(
      'SELECT COUNT(*)::int AS count FROM post_media WHERE post_id = $1',
      [postId]
    );
    const existingCount = existing ? existing.count : 0;

    if (existingCount + items.length > MAX_MEDIA_PER_POST) {
      throw new BadRequestError(
        `Cannot exceed ${MAX_MEDIA_PER_POST} media items per post`,
        'BAD_REQUEST',
        `Post already has ${existingCount} media items, trying to add ${items.length}. Max is ${MAX_MEDIA_PER_POST}`
      );
    }

    // Validate each item
    const validated = items.map((item, idx) => {
      if (!item.url || typeof item.url !== 'string') {
        throw new BadRequestError(
          `Media item ${idx}: url is required`,
          'BAD_REQUEST',
          'Each media item must have a url string'
        );
      }

      if (item.url.length > MAX_URL_LENGTH) {
        throw new BadRequestError(
          `Media item ${idx}: URL must be ${MAX_URL_LENGTH} characters or less`,
          'BAD_REQUEST',
          `URL is ${item.url.length} characters`
        );
      }

      try {
        new URL(item.url);
      } catch {
        throw new BadRequestError(
          `Media item ${idx}: invalid URL format`,
          'BAD_REQUEST',
          'Provide a valid URL starting with http:// or https://'
        );
      }

      const mediaType = item.type || 'image';
      if (!VALID_MEDIA_TYPES.includes(mediaType)) {
        throw new BadRequestError(
          `Media item ${idx}: invalid type '${mediaType}'`,
          'BAD_REQUEST',
          `Allowed types: ${VALID_MEDIA_TYPES.join(', ')}`
        );
      }

      if (item.altText && item.altText.length > MAX_ALT_TEXT_LENGTH) {
        throw new BadRequestError(
          `Media item ${idx}: alt text must be ${MAX_ALT_TEXT_LENGTH} characters or less`,
          'BAD_REQUEST',
          `Alt text is ${item.altText.length} characters`
        );
      }

      return {
        url: item.url,
        type: mediaType,
        altText: item.altText || null,
        position: typeof item.position === 'number' ? item.position : idx
      };
    });

    // Insert each item (ON CONFLICT skip duplicates)
    const results = [];
    for (const v of validated) {
      const row = await queryOne(
        `INSERT INTO post_media (post_id, media_url, media_type, alt_text, position)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (post_id, media_url) DO NOTHING
         RETURNING *`,
        [postId, v.url, v.type, v.altText, v.position]
      );
      if (row) results.push(row);
    }

    return results;
  }

  /**
   * Get all media for a post, ordered by position
   *
   * @param {string} postId
   * @returns {Promise<Object[]>}
   */
  static async getMedia(postId) {
    return queryAll(
      `SELECT id, media_url, media_type, alt_text, position, created_at
       FROM post_media
       WHERE post_id = $1
       ORDER BY position ASC, created_at ASC`,
      [postId]
    );
  }

  /**
   * Batch-fetch media for multiple posts (for feed enrichment)
   *
   * @param {string[]} postIds
   * @returns {Promise<Map<string, Object[]>>} Map of postId → media[]
   */
  static async getMediaForPosts(postIds) {
    if (!postIds || postIds.length === 0) return new Map();

    const rows = await queryAll(
      `SELECT id, post_id, media_url, media_type, alt_text, position, created_at
       FROM post_media
       WHERE post_id = ANY($1)
       ORDER BY position ASC, created_at ASC`,
      [postIds]
    );

    const map = new Map();
    for (const row of rows) {
      if (!map.has(row.post_id)) map.set(row.post_id, []);
      map.get(row.post_id).push(row);
    }
    return map;
  }

  /**
   * Remove a single media item
   *
   * @param {string} postId
   * @param {string} mediaId
   */
  static async removeMedia(postId, mediaId) {
    const result = await queryOne(
      'DELETE FROM post_media WHERE id = $1 AND post_id = $2 RETURNING id',
      [mediaId, postId]
    );
    if (!result) {
      throw new NotFoundError('Media item', 'Check the media ID');
    }
    return result;
  }

  /**
   * Remove all media from a post
   *
   * @param {string} postId
   */
  static async removeAllMedia(postId) {
    await queryOne(
      'DELETE FROM post_media WHERE post_id = $1',
      [postId]
    );
  }
}

module.exports = PostMediaService;
