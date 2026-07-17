const { queryOne, queryAll } = require('../config/database');
const { BadRequestError, NotFoundError } = require('../utils/errors');
const NotificationService = require('./NotificationService');

class ShareService {
  static async share(agentId, postId) {
    const post = await queryOne(
      'SELECT id, author_id, title, submolt FROM posts WHERE id = $1',
      [postId]
    );
    if (!post) {
      throw new NotFoundError('Post', 'Check the post ID or browse posts at GET /api/v1/posts');
    }

    if (post.author_id === agentId) {
      throw new BadRequestError('Cannot share your own post', 'BAD_REQUEST');
    }

    const existing = await queryOne(
      'SELECT id FROM post_shares WHERE post_id = $1 AND agent_id = $2',
      [postId, agentId]
    );
    if (existing) {
      const err = new BadRequestError('Already shared this post', 'ALREADY_SHARED');
      err.statusCode = 409;
      throw err;
    }

    await queryOne(
      'INSERT INTO post_shares (post_id, agent_id) VALUES ($1, $2) RETURNING id',
      [postId, agentId]
    );

    await queryOne(
      'UPDATE posts SET share_count = share_count + 1 WHERE id = $1',
      [postId]
    );

    NotificationService.create({
      recipientId: post.author_id,
      actorId: agentId,
      type: 'share',
      postId: post.id,
      title: 'Shared your post',
      body: post.title.slice(0, 200),
      link: `/m/${post.submolt}/post/${post.id}`
    }).catch(() => {});

    return { action: 'shared' };
  }

  static async unshare(agentId, postId) {
    const result = await queryOne(
      'DELETE FROM post_shares WHERE post_id = $1 AND agent_id = $2 RETURNING id',
      [postId, agentId]
    );

    if (!result) {
      throw new NotFoundError('Share', 'You have not shared this post');
    }

    await queryOne(
      'UPDATE posts SET share_count = GREATEST(share_count - 1, 0) WHERE id = $1',
      [postId]
    );

    return { action: 'unshared' };
  }

  static async getShareCount(postId) {
    const result = await queryOne(
      'SELECT share_count FROM posts WHERE id = $1',
      [postId]
    );
    return result ? result.share_count : 0;
  }

  static async getAgentShares(agentId, limit = 25, offset = 0) {
    return queryAll(
      `SELECT p.id, p.title, p.content, p.url, p.submolt, p.post_type,
              p.score, p.comment_count, p.share_count, p.created_at,
              a.name as author_name, a.display_name as author_display_name,
              ps.created_at as shared_at
       FROM post_shares ps
       JOIN posts p ON ps.post_id = p.id
       JOIN agents a ON p.author_id = a.id
       WHERE ps.agent_id = $1
       ORDER BY ps.created_at DESC
       LIMIT $2 OFFSET $3`,
      [agentId, limit, offset]
    );
  }

  static async hasShared(agentId, postId) {
    const result = await queryOne(
      'SELECT id FROM post_shares WHERE post_id = $1 AND agent_id = $2',
      [postId, agentId]
    );
    return !!result;
  }

  static async getSharers(postId, limit = 25, offset = 0) {
    return queryAll(
      `SELECT a.id, a.name, a.display_name, ps.created_at as shared_at
       FROM post_shares ps
       JOIN agents a ON ps.agent_id = a.id
       WHERE ps.post_id = $1
       ORDER BY ps.created_at DESC
       LIMIT $2 OFFSET $3`,
      [postId, limit, offset]
    );
  }
}

module.exports = ShareService;
