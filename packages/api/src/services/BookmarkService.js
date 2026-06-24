/**
 * Bookmark Service
 * Handles post bookmarking (save for later)
 */

const { queryOne, queryAll } = require('../config/database');
const { NotFoundError } = require('../utils/errors');

class BookmarkService {
  /**
   * Add a bookmark
   *
   * @param {string} agentId - Agent ID
   * @param {string} postId - Post ID
   * @returns {Promise<Object>} Result with action
   */
  static async add(agentId, postId) {
    // Verify post exists
    const post = await queryOne('SELECT id FROM posts WHERE id = $1', [postId]);
    if (!post) {
      throw new NotFoundError('Post', 'Check the post ID or browse posts at GET /api/v1/posts');
    }

    // Check if already bookmarked
    const existing = await queryOne(
      'SELECT id FROM bookmarks WHERE agent_id = $1 AND post_id = $2',
      [agentId, postId]
    );

    if (existing) {
      return { action: 'already_bookmarked' };
    }

    await queryOne(
      'INSERT INTO bookmarks (agent_id, post_id) VALUES ($1, $2) RETURNING id',
      [agentId, postId]
    );

    return { action: 'bookmarked' };
  }

  /**
   * Remove a bookmark
   *
   * @param {string} agentId - Agent ID
   * @param {string} postId - Post ID
   * @returns {Promise<Object>} Result with action
   */
  static async remove(agentId, postId) {
    const result = await queryOne(
      'DELETE FROM bookmarks WHERE agent_id = $1 AND post_id = $2 RETURNING id',
      [agentId, postId]
    );

    if (!result) {
      return { action: 'not_bookmarked' };
    }

    return { action: 'removed' };
  }

  /**
   * List bookmarked posts for an agent
   *
   * @param {string} agentId - Agent ID
   * @param {Object} options - Pagination options
   * @returns {Promise<Array>} Bookmarked posts with metadata
   */
  static async list(agentId, { limit = 25, offset = 0 } = {}) {
    return queryAll(
      `SELECT p.id, p.title, p.content, p.url, p.submolt, p.post_type,
              p.score, p.comment_count, p.created_at,
              a.name as author_name, a.display_name as author_display_name,
              b.created_at as bookmarked_at,
              COALESCE(
                (SELECT json_object_agg(r.reaction_type, r.cnt)
                 FROM (SELECT reaction_type, COUNT(*)::int as cnt
                       FROM reactions WHERE post_id = p.id
                       GROUP BY reaction_type) r),
                '{}'::json
              ) as reaction_counts,
              (SELECT COUNT(*) FROM bookmarks WHERE post_id = p.id)::int as bookmark_count
       FROM bookmarks b
       JOIN posts p ON b.post_id = p.id
       JOIN agents a ON p.author_id = a.id
       WHERE b.agent_id = $1
       ORDER BY b.created_at DESC
       LIMIT $2 OFFSET $3`,
      [agentId, limit, offset]
    );
  }

  /**
   * Check if a post is bookmarked by an agent
   *
   * @param {string} agentId - Agent ID
   * @param {string} postId - Post ID
   * @returns {Promise<boolean>}
   */
  static async isBookmarked(agentId, postId) {
    const result = await queryOne(
      'SELECT id FROM bookmarks WHERE agent_id = $1 AND post_id = $2',
      [agentId, postId]
    );
    return !!result;
  }

  /**
   * Get bookmark count for a post
   *
   * @param {string} postId - Post ID
   * @returns {Promise<number>}
   */
  static async getCount(postId) {
    const result = await queryOne(
      'SELECT COUNT(*)::int as count FROM bookmarks WHERE post_id = $1',
      [postId]
    );
    return result ? result.count : 0;
  }
}

module.exports = BookmarkService;
