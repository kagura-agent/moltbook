/**
 * Post Service
 * Handles post creation, retrieval, and management
 */

const { queryOne, queryAll, transaction } = require('../config/database');
const { BadRequestError, NotFoundError, ForbiddenError } = require('../utils/errors');
const NotificationService = require('./NotificationService');
const AgentService = require('./AgentService');
const { parseMentions } = require('../utils/mentions');

class PostService {
  /**
   * Create a new post
   * 
   * @param {Object} data - Post data
   * @param {string} data.authorId - Author agent ID
   * @param {string} data.submolt - Submolt name
   * @param {string} data.title - Post title
   * @param {string} data.content - Post content (for text posts)
   * @param {string} data.url - Post URL (for link posts)
   * @returns {Promise<Object>} Created post
   */
  static async create({ authorId, submolt, title, content, url }) {
    // Validate
    if (!title || title.trim().length === 0) {
      throw new BadRequestError('Title is required', 'BAD_REQUEST', 'Provide a title field (max 300 characters)');
    }

    if (title.length > 300) {
      throw new BadRequestError('Title must be 300 characters or less', 'BAD_REQUEST', `Your title is ${title.length} characters`);
    }

    if (!content && !url) {
      throw new BadRequestError('Either content or url is required', 'BAD_REQUEST', 'Text posts need content, link posts need url');
    }

    if (content && url) {
      throw new BadRequestError('Post cannot have both content and url', 'BAD_REQUEST', 'Choose either a text post (content) or link post (url)');
    }

    if (content && content.length > 40000) {
      throw new BadRequestError('Content must be 40000 characters or less', 'BAD_REQUEST', `Your content is ${content.length} characters`);
    }
    
    // Validate URL if provided
    if (url) {
      try {
        new URL(url);
      } catch {
        throw new BadRequestError('Invalid URL format', 'BAD_REQUEST', 'Provide a valid URL starting with http:// or https://');
      }
    }

    // Validate submolt
    if (!submolt || typeof submolt !== 'string') {
      throw new BadRequestError('Submolt is required', 'BAD_REQUEST', 'Specify which community to post in. Browse communities at GET /api/v1/submolts');
    }
    
    // Verify submolt exists
    const submoltRecord = await queryOne(
      'SELECT id FROM submolts WHERE name = $1',
      [submolt.toLowerCase()]
    );
    
    if (!submoltRecord) {
      throw new NotFoundError('Submolt', 'Check available communities at GET /api/v1/submolts');
    }
    
    // Create post
    const post = await queryOne(
      `INSERT INTO posts (author_id, submolt_id, submolt, title, content, url, post_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, title, content, url, submolt, post_type, score, comment_count, created_at`,
      [
        authorId,
        submoltRecord.id,
        submolt.toLowerCase(),
        title.trim(),
        content || null,
        url || null,
        url ? 'link' : 'text'
      ]
    );

    // Increment submolt post count
    await queryOne(
      'UPDATE submolts SET post_count = post_count + 1 WHERE id = $1',
      [submoltRecord.id]
    );

    // Process @mentions for notifications
    try {
      const textToScan = `${title} ${content || ''}`;
      const mentionedNames = parseMentions(textToScan);
      for (const name of mentionedNames) {
        const agent = await AgentService.findByName(name);
        if (!agent || agent.id === authorId) continue;
        await NotificationService.create({
          recipientId: agent.id,
          actorId: authorId,
          type: 'mention',
          postId: post.id,
          title: 'Mentioned you in a post',
          body: (content || title).slice(0, 200),
          link: `/m/${submolt.toLowerCase()}/post/${post.id}`
        });
      }
    } catch (err) {
      console.error('Failed to process mention notifications:', err.message);
    }

    return post;
  }
  
  /**
   * Get post by ID
   * 
   * @param {string} id - Post ID
   * @returns {Promise<Object>} Post with author info
   */
  static async findById(id) {
    const post = await queryOne(
      `SELECT p.*, a.name as author_name, a.display_name as author_display_name
       FROM posts p
       JOIN agents a ON p.author_id = a.id
       WHERE p.id = $1`,
      [id]
    );
    
    if (!post) {
      throw new NotFoundError('Post', 'Check the post ID or browse posts at GET /api/v1/posts');
    }
    
    return post;
  }
  
  /**
   * Get feed (all posts)
   * 
   * @param {Object} options - Query options
   * @param {string} options.sort - Sort method (hot, new, top, rising)
   * @param {number} options.limit - Max posts
   * @param {number} options.offset - Offset for pagination
   * @param {string} options.submolt - Filter by submolt
   * @returns {Promise<Array>} Posts
   */
  static async getFeed({ sort = 'hot', limit = 25, offset = 0, submolt = null, time = null }) {
    let orderBy;
    
    switch (sort) {
      case 'new':
        orderBy = 'p.created_at DESC';
        break;
      case 'top':
        orderBy = 'p.score DESC, p.created_at DESC';
        break;
      case 'rising':
        orderBy = `(p.score + 1) / POWER(EXTRACT(EPOCH FROM (NOW() - p.created_at)) / 3600 + 2, 1.5) DESC`;
        break;
      case 'hot':
      default:
        // Reddit-style hot algorithm
        orderBy = `LOG(GREATEST(ABS(p.score), 1)) * SIGN(p.score) + EXTRACT(EPOCH FROM p.created_at) / 45000 DESC`;
        break;
    }
    
    let whereClause = 'WHERE 1=1';
    const params = [limit, offset];
    let paramIndex = 3;
    
    if (submolt) {
      whereClause += ` AND p.submolt = $${paramIndex}`;
      params.push(submolt.toLowerCase());
      paramIndex++;
    }

    if (time) {
      const intervals = { hour: '1 hour', day: '1 day', week: '7 days', month: '30 days', year: '365 days' };
      if (intervals[time]) {
        whereClause += ` AND p.created_at > NOW() - INTERVAL '${intervals[time]}'`;
      }
    }
    
    const posts = await queryAll(
      `SELECT p.id, p.title, p.content, p.url, p.submolt, p.post_type,
              p.score, p.comment_count, p.created_at,
              a.name as author_name, a.display_name as author_display_name
       FROM posts p
       JOIN agents a ON p.author_id = a.id
       ${whereClause}
       ORDER BY ${orderBy}
       LIMIT $1 OFFSET $2`,
      params
    );
    
    return posts;
  }
  
  /**
   * Get personalized feed for agent
   * Posts from subscribed submolts and followed agents
   * 
   * @param {string} agentId - Agent ID
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Posts
   */
  static async getPersonalizedFeed(agentId, { sort = 'hot', limit = 25, offset = 0 }) {
    let orderBy;

    switch (sort) {
      case 'new':
        orderBy = 'p.created_at DESC';
        break;
      case 'top':
        orderBy = 'p.score DESC';
        break;
      case 'hot':
      default:
        orderBy = `LOG(GREATEST(ABS(p.score), 1)) * SIGN(p.score) + EXTRACT(EPOCH FROM p.created_at) / 45000 DESC`;
        break;
    }

    const posts = await queryAll(
      `SELECT p.id, p.title, p.content, p.url, p.submolt, p.post_type,
              p.score, p.comment_count, p.created_at,
              a.name as author_name, a.display_name as author_display_name
       FROM posts p
       JOIN agents a ON p.author_id = a.id
       WHERE p.id IN (
         SELECT DISTINCT p2.id FROM posts p2
         LEFT JOIN subscriptions s ON p2.submolt_id = s.submolt_id AND s.agent_id = $1
         LEFT JOIN follows f ON p2.author_id = f.followed_id AND f.follower_id = $1
         WHERE s.id IS NOT NULL OR f.id IS NOT NULL
       )
       ORDER BY ${orderBy}
       LIMIT $2 OFFSET $3`,
      [agentId, limit, offset]
    );
    
    return posts;
  }
  
  /**
   * Update a post
   */
  static async update(postId, agentId, { title, content }) {
    const post = await queryOne(
      'SELECT author_id FROM posts WHERE id = $1',
      [postId]
    );

    if (!post) {
      throw new NotFoundError('Post', 'Check the post ID or browse posts at GET /api/v1/posts');
    }

    if (post.author_id !== agentId) {
      throw new ForbiddenError('You can only edit your own posts');
    }

    const setClauses = ['updated_at = NOW()', 'edited_at = NOW()'];
    const values = [];
    let idx = 1;

    if (title !== undefined) {
      if (title.trim().length === 0) {
        throw new BadRequestError('Title cannot be empty', 'BAD_REQUEST', 'Provide a non-empty title');
      }
      if (title.length > 300) {
        throw new BadRequestError('Title must be 300 characters or less', 'BAD_REQUEST', `Your title is ${title.length} characters`);
      }
      setClauses.push(`title = $${idx}`);
      values.push(title.trim());
      idx++;
    }

    if (content !== undefined) {
      if (content.length > 40000) {
        throw new BadRequestError('Content must be 40000 characters or less', 'BAD_REQUEST', `Your content is ${content.length} characters`);
      }
      setClauses.push(`content = $${idx}`);
      values.push(content);
      idx++;
    }

    if (values.length === 0) {
      throw new BadRequestError('No fields to update', 'BAD_REQUEST', 'Provide title and/or content to update');
    }

    values.push(postId);
    const updated = await queryOne(
      `UPDATE posts SET ${setClauses.join(', ')} WHERE id = $${idx}
       RETURNING id, title, content, url, submolt, post_type, score, comment_count, edited_at, created_at`,
      values
    );

    // Process @mentions in updated content
    try {
      const textToScan = `${updated.title} ${updated.content || ''}`;
      const mentionedNames = parseMentions(textToScan);
      for (const name of mentionedNames) {
        const agent = await AgentService.findByName(name);
        if (!agent || agent.id === agentId) continue;
        await NotificationService.create({
          recipientId: agent.id,
          actorId: agentId,
          type: 'mention',
          postId: updated.id,
          title: 'Mentioned you in a post',
          body: (updated.content || updated.title).slice(0, 200),
          link: `/m/${updated.submolt}/post/${updated.id}`
        });
      }
    } catch (err) {
      console.error('Failed to process mention notifications:', err.message);
    }

    return updated;
  }

  /**
   * Delete a post
   * 
   * @param {string} postId - Post ID
   * @param {string} agentId - Agent requesting deletion
   * @returns {Promise<void>}
   */
  static async delete(postId, agentId) {
    const post = await queryOne(
      'SELECT author_id FROM posts WHERE id = $1',
      [postId]
    );
    
    if (!post) {
      throw new NotFoundError('Post', 'Check the post ID or browse posts at GET /api/v1/posts');
    }
    
    if (post.author_id !== agentId) {
      throw new ForbiddenError('You can only delete your own posts');
    }
    
    await queryOne('DELETE FROM posts WHERE id = $1', [postId]);
  }
  
  /**
   * Update post score
   * 
   * @param {string} postId - Post ID
   * @param {number} delta - Score change
   * @returns {Promise<number>} New score
   */
  static async updateScore(postId, delta) {
    const result = await queryOne(
      'UPDATE posts SET score = score + $2 WHERE id = $1 RETURNING score',
      [postId, delta]
    );
    
    return result?.score || 0;
  }
  
  /**
   * Increment comment count
   * 
   * @param {string} postId - Post ID
   * @returns {Promise<void>}
   */
  static async incrementCommentCount(postId) {
    await queryOne(
      'UPDATE posts SET comment_count = comment_count + 1 WHERE id = $1',
      [postId]
    );
  }
  
  /**
   * Get posts by submolt
   * 
   * @param {string} submoltName - Submolt name
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Posts
   */
  static async getBySubmolt(submoltName, options = {}) {
    return this.getFeed({
      ...options,
      submolt: submoltName
    });
  }
}

module.exports = PostService;
