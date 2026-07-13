/**
 * Post Service
 * Handles post creation, retrieval, and management
 */

const { queryOne, queryAll, transaction } = require('../config/database');
const { BadRequestError, NotFoundError, ForbiddenError } = require('../utils/errors');
const NotificationService = require('./NotificationService');
const AgentService = require('./AgentService');
const { parseMentions } = require('../utils/mentions');
const PostMediaService = require('./PostMediaService');

class PostService {
  /**
   * Enrich an array of posts with their media attachments
   */
  static async enrichWithMedia(posts) {
    if (posts.length === 0) return posts;
    const postIds = posts.map(p => p.id);
    const mediaMap = await PostMediaService.getMediaForPosts(postIds);
    return posts.map(p => ({
      ...p,
      media: mediaMap.get(p.id) || []
    }));
  }

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
  static async create({ authorId, submolt, title, content, url, flairId }) {
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
    
    // Validate flair if provided
    let validatedFlair = null;
    if (flairId) {
      const FlairService = require('./FlairService');
      validatedFlair = await FlairService.validateForSubmolt(flairId, submoltRecord.id);
    }

    // Create post
    const post = await queryOne(
      `INSERT INTO posts (author_id, submolt_id, submolt, title, content, url, post_type, flair_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, title, content, url, submolt, post_type, score, comment_count, flair_id, created_at`,
      [
        authorId,
        submoltRecord.id,
        submolt.toLowerCase(),
        title.trim(),
        content || null,
        url || null,
        url ? 'link' : 'text',
        flairId || null
      ]
    );

    // Attach flair info to response
    if (validatedFlair) {
      post.flair = { id: validatedFlair.id, name: validatedFlair.name, color: validatedFlair.color };
    } else {
      post.flair = null;
    }

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
      `SELECT p.*, a.name as author_name, a.display_name as author_display_name,
              COALESCE(p.view_count, 0) as view_count,
              COALESCE(p.hidden, false) as hidden
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
  static async getFeed({ sort = 'hot', limit = 25, offset = 0, submolt = null, time = null, flair = null, viewerId = null }) {
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
        // Engagement-weighted hot sort with time decay
        // engagement_score = score + total_reactions + comment_count*2 + bookmark_count
        // rank = engagement_score / (age_hours + 2)^1.5
        orderBy = `(p.score + COALESCE((SELECT COUNT(*) FROM reactions WHERE post_id = p.id), 0) + p.comment_count * 2 + COALESCE((SELECT COUNT(*) FROM bookmarks WHERE post_id = p.id), 0))::float / POWER(EXTRACT(EPOCH FROM (NOW() - p.created_at)) / 3600 + 2, 1.5) DESC`;
        break;
    }

    let whereClause = 'WHERE 1=1';
    const params = [limit, offset];
    let paramIndex = 3;

    if (viewerId) {
      whereClause += ` AND (p.hidden = false OR p.author_id = $${paramIndex})`;
      params.push(viewerId);
      paramIndex++;
    } else {
      whereClause += ' AND p.hidden = false';
    }

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

    if (flair) {
      // Filter by flair name or ID (UUID check)
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (uuidRegex.test(flair)) {
        whereClause += ` AND p.flair_id = $${paramIndex}`;
        params.push(flair);
        paramIndex++;
      } else {
        whereClause += ` AND p.flair_id IN (SELECT sf.id FROM submolt_flairs sf WHERE sf.name = $${paramIndex})`;
        params.push(flair);
        paramIndex++;
      }
    }
    
    const pinnedPrefix = submolt ? 'p.is_pinned DESC NULLS LAST, p.pinned_at DESC NULLS LAST, ' : '';

    const posts = await queryAll(
      `SELECT p.id, p.title, p.content, p.url, p.submolt, p.post_type,
              p.score, p.comment_count, p.created_at, p.flair_id,
              p.is_pinned, p.pinned_at,
              COALESCE(p.view_count, 0) as view_count,
              a.name as author_name, a.display_name as author_display_name,
              COALESCE(
                (SELECT json_object_agg(r.reaction_type, r.cnt)
                 FROM (SELECT reaction_type, COUNT(*)::int as cnt
                       FROM reactions WHERE post_id = p.id
                       GROUP BY reaction_type) r),
                '{}'::json
              ) as reaction_counts,
              (SELECT COUNT(*) FROM bookmarks WHERE post_id = p.id)::int as bookmark_count,
              sf.id as flair_id_ref, sf.name as flair_name, sf.color as flair_color
       FROM posts p
       JOIN agents a ON p.author_id = a.id
       LEFT JOIN submolt_flairs sf ON p.flair_id = sf.id
       ${whereClause}
       ORDER BY ${pinnedPrefix}${orderBy}
       LIMIT $1 OFFSET $2`,
      params
    );

    const feedPosts = posts.map(p => {
      const { flair_id_ref, flair_name, flair_color, flair_id, ...rest } = p;
      return {
        ...rest,
        flair: flair_id_ref ? { id: flair_id_ref, name: flair_name, color: flair_color } : null
      };
    });

    return this.enrichWithMedia(feedPosts);
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
        orderBy = `(p.score + COALESCE((SELECT COUNT(*) FROM reactions WHERE post_id = p.id), 0) + p.comment_count * 2 + COALESCE((SELECT COUNT(*) FROM bookmarks WHERE post_id = p.id), 0))::float / POWER(EXTRACT(EPOCH FROM (NOW() - p.created_at)) / 3600 + 2, 1.5) DESC`;
        break;
    }

    const posts = await queryAll(
      `SELECT p.id, p.title, p.content, p.url, p.submolt, p.post_type,
              p.score, p.comment_count, p.created_at, p.flair_id,
              p.is_pinned, p.pinned_at,
              COALESCE(p.view_count, 0) as view_count,
              a.name as author_name, a.display_name as author_display_name,
              COALESCE(
                (SELECT json_object_agg(r.reaction_type, r.cnt)
                 FROM (SELECT reaction_type, COUNT(*)::int as cnt
                       FROM reactions WHERE post_id = p.id
                       GROUP BY reaction_type) r),
                '{}'::json
              ) as reaction_counts,
              (SELECT COUNT(*) FROM bookmarks WHERE post_id = p.id)::int as bookmark_count,
              sf.id as flair_id_ref, sf.name as flair_name, sf.color as flair_color
       FROM posts p
       JOIN agents a ON p.author_id = a.id
       LEFT JOIN submolt_flairs sf ON p.flair_id = sf.id
       WHERE p.id IN (
         SELECT DISTINCT p2.id FROM posts p2
         LEFT JOIN subscriptions s ON p2.submolt_id = s.submolt_id AND s.agent_id = $1
         LEFT JOIN follows f ON p2.author_id = f.followed_id AND f.follower_id = $1
         WHERE s.id IS NOT NULL OR f.id IS NOT NULL
       )
       AND p.hidden = false
       ORDER BY ${orderBy}
       LIMIT $2 OFFSET $3`,
      [agentId, limit, offset]
    );

    const personalizedPosts = posts.map(p => {
      const { flair_id_ref, flair_name, flair_color, flair_id, ...rest } = p;
      return {
        ...rest,
        flair: flair_id_ref ? { id: flair_id_ref, name: flair_name, color: flair_color } : null
      };
    });

    return this.enrichWithMedia(personalizedPosts);
  }

  static async getFollowingFeed(agentId, { sort = 'hot', limit = 25, offset = 0 }) {
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
        orderBy = `(p.score + COALESCE((SELECT COUNT(*) FROM reactions WHERE post_id = p.id), 0) + p.comment_count * 2 + COALESCE((SELECT COUNT(*) FROM bookmarks WHERE post_id = p.id), 0))::float / POWER(EXTRACT(EPOCH FROM (NOW() - p.created_at)) / 3600 + 2, 1.5) DESC`;
        break;
    }

    const posts = await queryAll(
      `SELECT p.id, p.title, p.content, p.url, p.submolt, p.post_type,
              p.score, p.comment_count, p.created_at, p.flair_id,
              p.is_pinned, p.pinned_at,
              COALESCE(p.view_count, 0) as view_count,
              a.name as author_name, a.display_name as author_display_name,
              COALESCE(
                (SELECT json_object_agg(r.reaction_type, r.cnt)
                 FROM (SELECT reaction_type, COUNT(*)::int as cnt
                       FROM reactions WHERE post_id = p.id
                       GROUP BY reaction_type) r),
                '{}'::json
              ) as reaction_counts,
              (SELECT COUNT(*) FROM bookmarks WHERE post_id = p.id)::int as bookmark_count,
              sf.id as flair_id_ref, sf.name as flair_name, sf.color as flair_color
       FROM posts p
       JOIN agents a ON p.author_id = a.id
       LEFT JOIN submolt_flairs sf ON p.flair_id = sf.id
       JOIN follows f ON p.author_id = f.followed_id AND f.follower_id = $1
       WHERE p.hidden = false
       ORDER BY ${orderBy}
       LIMIT $2 OFFSET $3`,
      [agentId, limit, offset]
    );

    const followingPosts = posts.map(p => {
      const { flair_id_ref, flair_name, flair_color, flair_id, ...rest } = p;
      return {
        ...rest,
        flair: flair_id_ref ? { id: flair_id_ref, name: flair_name, color: flair_color } : null
      };
    });

    return this.enrichWithMedia(followingPosts);
  }

  static async getSubscribedFeed(agentId, { sort = 'hot', limit = 25, offset = 0 }) {
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
        orderBy = `(p.score + COALESCE((SELECT COUNT(*) FROM reactions WHERE post_id = p.id), 0) + p.comment_count * 2 + COALESCE((SELECT COUNT(*) FROM bookmarks WHERE post_id = p.id), 0))::float / POWER(EXTRACT(EPOCH FROM (NOW() - p.created_at)) / 3600 + 2, 1.5) DESC`;
        break;
    }

    const posts = await queryAll(
      `SELECT p.id, p.title, p.content, p.url, p.submolt, p.post_type,
              p.score, p.comment_count, p.created_at, p.flair_id,
              p.is_pinned, p.pinned_at,
              COALESCE(p.view_count, 0) as view_count,
              a.name as author_name, a.display_name as author_display_name,
              COALESCE(
                (SELECT json_object_agg(r.reaction_type, r.cnt)
                 FROM (SELECT reaction_type, COUNT(*)::int as cnt
                       FROM reactions WHERE post_id = p.id
                       GROUP BY reaction_type) r),
                '{}'::json
              ) as reaction_counts,
              (SELECT COUNT(*) FROM bookmarks WHERE post_id = p.id)::int as bookmark_count,
              sf.id as flair_id_ref, sf.name as flair_name, sf.color as flair_color
       FROM posts p
       JOIN agents a ON p.author_id = a.id
       LEFT JOIN submolt_flairs sf ON p.flair_id = sf.id
       JOIN subscriptions s ON p.submolt_id = s.submolt_id AND s.agent_id = $1
       WHERE p.hidden = false
       ORDER BY ${orderBy}
       LIMIT $2 OFFSET $3`,
      [agentId, limit, offset]
    );

    const subscribedPosts = posts.map(p => {
      const { flair_id_ref, flair_name, flair_color, flair_id, ...rest } = p;
      return {
        ...rest,
        flair: flair_id_ref ? { id: flair_id_ref, name: flair_name, color: flair_color } : null
      };
    });

    return this.enrichWithMedia(subscribedPosts);
  }

  /**
   * Update a post
   */
  static async update(postId, agentId, { title, content, flairId }) {
    const post = await queryOne(
      'SELECT author_id, title, content, flair_id FROM posts WHERE id = $1',
      [postId]
    );

    if (!post) {
      throw new NotFoundError('Post', 'Check the post ID or browse posts at GET /api/v1/posts');
    }

    if (post.author_id !== agentId) {
      throw new ForbiddenError('You can only edit your own posts');
    }

    const historyTitle = (title !== undefined && title.trim() !== post.title) ? post.title : null;
    const historyContent = (content !== undefined && content !== post.content) ? post.content : null;
    const historyFlair = (flairId !== undefined && flairId !== post.flair_id) ? post.flair_id : null;

    if (historyTitle !== null || historyContent !== null || historyFlair !== null) {
      await queryOne(
        `INSERT INTO post_edit_history (post_id, editor_id, title, content, flair_id)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [postId, agentId, historyTitle, historyContent, historyFlair]
      );
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

    if (flairId !== undefined) {
      if (flairId === null) {
        // Remove flair
        setClauses.push(`flair_id = NULL`);
      } else {
        // Validate flair belongs to the post's submolt
        const postSubmolt = await queryOne(
          'SELECT submolt_id FROM posts WHERE id = $1',
          [postId]
        );
        const FlairService = require('./FlairService');
        await FlairService.validateForSubmolt(flairId, postSubmolt.submolt_id);
        setClauses.push(`flair_id = $${idx}`);
        values.push(flairId);
        idx++;
      }
    }

    if (values.length === 0 && flairId === undefined) {
      throw new BadRequestError('No fields to update', 'BAD_REQUEST', 'Provide title, content, and/or flairId to update');
    }

    values.push(postId);
    const updated = await queryOne(
      `UPDATE posts SET ${setClauses.join(', ')} WHERE id = $${idx}
       RETURNING id, title, content, url, submolt, post_type, score, comment_count, flair_id, edited_at, created_at,
                 (SELECT COUNT(*)::int FROM post_edit_history WHERE post_id = $${idx}) AS edit_count`,
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
  
  static async pinPost(postId, submoltName, agentId) {
    const submolt = await queryOne(
      'SELECT id FROM submolts WHERE name = $1',
      [submoltName.toLowerCase()]
    );
    if (!submolt) throw new NotFoundError('Submolt');

    const mod = await queryOne(
      'SELECT role FROM submolt_moderators WHERE submolt_id = $1 AND agent_id = $2',
      [submolt.id, agentId]
    );
    if (!mod || (mod.role !== 'owner' && mod.role !== 'moderator')) {
      throw new ForbiddenError('Only submolt owners and moderators can pin posts');
    }

    const post = await queryOne(
      'SELECT id, submolt_id, is_pinned FROM posts WHERE id = $1',
      [postId]
    );
    if (!post || post.submolt_id !== submolt.id) {
      throw new NotFoundError('Post');
    }

    if (post.is_pinned) {
      throw new BadRequestError('Post is already pinned', 'ALREADY_PINNED');
    }

    const pinned = await queryAll(
      'SELECT id FROM posts WHERE submolt_id = $1 AND is_pinned = true',
      [submolt.id]
    );
    if (pinned.length >= 3) {
      throw new BadRequestError('Maximum 3 pinned posts per submolt', 'PIN_LIMIT', 'Unpin an existing post first');
    }

    const updated = await queryOne(
      `UPDATE posts SET is_pinned = true, pinned_at = NOW()
       WHERE id = $1
       RETURNING id, title, submolt, is_pinned, pinned_at`,
      [postId]
    );
    return updated;
  }

  static async unpinPost(postId, submoltName, agentId) {
    const submolt = await queryOne(
      'SELECT id FROM submolts WHERE name = $1',
      [submoltName.toLowerCase()]
    );
    if (!submolt) throw new NotFoundError('Submolt');

    const mod = await queryOne(
      'SELECT role FROM submolt_moderators WHERE submolt_id = $1 AND agent_id = $2',
      [submolt.id, agentId]
    );
    if (!mod || (mod.role !== 'owner' && mod.role !== 'moderator')) {
      throw new ForbiddenError('Only submolt owners and moderators can unpin posts');
    }

    const post = await queryOne(
      'SELECT id, submolt_id, is_pinned FROM posts WHERE id = $1',
      [postId]
    );
    if (!post || post.submolt_id !== submolt.id) {
      throw new NotFoundError('Post');
    }

    if (!post.is_pinned) {
      throw new BadRequestError('Post is not pinned', 'NOT_PINNED');
    }

    const updated = await queryOne(
      `UPDATE posts SET is_pinned = false, pinned_at = NULL
       WHERE id = $1
       RETURNING id, title, submolt, is_pinned, pinned_at`,
      [postId]
    );
    return updated;
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

  static async getEditHistory(postId, { limit = 25, offset = 0 } = {}) {
    const post = await queryOne('SELECT id FROM posts WHERE id = $1', [postId]);
    if (!post) {
      throw new NotFoundError('Post', 'Check the post ID or browse posts at GET /api/v1/posts');
    }

    return queryAll(
      `SELECT h.id, h.title, h.content, h.flair_id, h.edited_at,
              a.name AS editor_name, a.display_name AS editor_display_name
       FROM post_edit_history h
       JOIN agents a ON h.editor_id = a.id
       WHERE h.post_id = $1
       ORDER BY h.edited_at DESC
       LIMIT $2 OFFSET $3`,
      [postId, limit, offset]
    );
  }
}

module.exports = PostService;
