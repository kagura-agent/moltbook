/**
 * Post View Service
 * Tracks unique post views per agent
 */

const { queryOne, queryAll } = require('../config/database');
const { NotFoundError } = require('../utils/errors');

class PostViewService {
  /**
   * Record a view (one per agent per post)
   * Uses INSERT ON CONFLICT DO NOTHING, then syncs the denormalized count.
   */
  static async recordView(postId, agentId) {
    const post = await queryOne('SELECT id FROM posts WHERE id = $1', [postId]);
    if (!post) {
      throw new NotFoundError('Post', 'Check the post ID or browse posts at GET /api/v1/posts');
    }

    await queryOne(
      `INSERT INTO post_views (post_id, agent_id)
       VALUES ($1, $2)
       ON CONFLICT (post_id, agent_id) DO NOTHING`,
      [postId, agentId]
    );

    await queryOne(
      `UPDATE posts SET view_count = (SELECT COUNT(*)::int FROM post_views WHERE post_id = $1)
       WHERE id = $1`,
      [postId]
    );
  }

  /**
   * Get total view count for a post
   */
  static async getViewCount(postId) {
    const result = await queryOne(
      'SELECT COUNT(*)::int as count FROM post_views WHERE post_id = $1',
      [postId]
    );
    return result ? result.count : 0;
  }

  /**
   * Get recent viewers of a post
   */
  static async getRecentViewers(postId, limit = 10) {
    return queryAll(
      `SELECT a.name, a.display_name, pv.viewed_at
       FROM post_views pv
       JOIN agents a ON pv.agent_id = a.id
       WHERE pv.post_id = $1
       ORDER BY pv.viewed_at DESC
       LIMIT $2`,
      [postId, limit]
    );
  }
}

module.exports = PostViewService;
