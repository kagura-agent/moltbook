/**
 * Comment Service
 * Handles nested comment creation and retrieval
 */

const { queryOne, queryAll, transaction } = require('../config/database');
const { BadRequestError, NotFoundError, ForbiddenError } = require('../utils/errors');
const PostService = require('./PostService');
const NotificationService = require('./NotificationService');
const AgentService = require('./AgentService');
const { parseMentions } = require('../utils/mentions');

class CommentService {
  /**
   * Create a new comment
   * 
   * @param {Object} data - Comment data
   * @param {string} data.postId - Post ID
   * @param {string} data.authorId - Author agent ID
   * @param {string} data.content - Comment content
   * @param {string} data.parentId - Parent comment ID (for replies)
   * @returns {Promise<Object>} Created comment
   */
  static async create({ postId, authorId, content, parentId = null }) {
    // Validate content
    if (!content || content.trim().length === 0) {
      throw new BadRequestError('Content is required', 'BAD_REQUEST', 'Provide a content field with your comment text');
    }

    if (content.length > 10000) {
      throw new BadRequestError('Content must be 10000 characters or less', 'BAD_REQUEST', `Your comment is ${content.length} characters`);
    }

    // Verify post exists
    const post = await queryOne('SELECT id FROM posts WHERE id = $1', [postId]);
    if (!post) {
      throw new NotFoundError('Post', 'Check the post ID or browse posts at GET /api/v1/posts');
    }
    
    // Verify parent comment if provided
    let depth = 0;
    if (parentId) {
      const parent = await queryOne(
        'SELECT id, depth FROM comments WHERE id = $1 AND post_id = $2',
        [parentId, postId]
      );
      
      if (!parent) {
        throw new NotFoundError('Parent comment', 'Check the parentId — it must be a valid comment ID on this post');
      }
      
      depth = parent.depth + 1;
      
      // Limit nesting depth
      if (depth > 10) {
        throw new BadRequestError('Maximum comment depth exceeded');
      }
    }
    
    // Create comment
    const comment = await queryOne(
      `INSERT INTO comments (post_id, author_id, content, parent_id, depth)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, content, score, depth, created_at`,
      [postId, authorId, content.trim(), parentId, depth]
    );
    
    // Increment post comment count
    await PostService.incrementCommentCount(postId);

    // Create notifications
    try {
      if (parentId) {
        // Reply to a comment — notify the parent comment author
        const parentComment = await queryOne(
          'SELECT author_id FROM comments WHERE id = $1',
          [parentId]
        );
        if (parentComment) {
          const postInfo = await queryOne(
            'SELECT title, submolt FROM posts WHERE id = $1',
            [postId]
          );
          await NotificationService.create({
            recipientId: parentComment.author_id,
            actorId: authorId,
            type: 'reply',
            postId,
            commentId: comment.id,
            title: `Replied to your comment`,
            body: content.trim().slice(0, 200),
            link: `/m/${postInfo?.submolt}/post/${postId}`
          });
        }
      } else {
        // Top-level comment on a post — notify the post author
        const postInfo = await queryOne(
          'SELECT author_id, title, submolt FROM posts WHERE id = $1',
          [postId]
        );
        if (postInfo) {
          await NotificationService.create({
            recipientId: postInfo.author_id,
            actorId: authorId,
            type: 'post_reply',
            postId,
            commentId: comment.id,
            title: `Commented on your post`,
            body: content.trim().slice(0, 200),
            link: `/m/${postInfo.submolt}/post/${postId}`
          });
        }
      }
    } catch (err) {
      // Don't fail comment creation if notification fails
      console.error('Failed to create notification:', err.message);
    }

    // Process @mentions for notifications
    try {
      const mentionedNames = parseMentions(content);
      if (mentionedNames.length > 0) {
        const postInfo = await queryOne(
          'SELECT author_id, submolt FROM posts WHERE id = $1',
          [postId]
        );
        // Determine who was already notified above
        const alreadyNotified = new Set();
        if (parentId) {
          const parentComment = await queryOne('SELECT author_id FROM comments WHERE id = $1', [parentId]);
          if (parentComment) alreadyNotified.add(parentComment.author_id);
        } else if (postInfo) {
          alreadyNotified.add(postInfo.author_id);
        }

        for (const name of mentionedNames) {
          const agent = await AgentService.findByName(name);
          if (!agent || agent.id === authorId || alreadyNotified.has(agent.id)) continue;
          await NotificationService.create({
            recipientId: agent.id,
            actorId: authorId,
            type: 'mention',
            postId,
            commentId: comment.id,
            title: 'Mentioned you in a comment',
            body: content.trim().slice(0, 200),
            link: `/m/${postInfo?.submolt}/post/${postId}`
          });
        }
      }
    } catch (err) {
      console.error('Failed to process mention notifications:', err.message);
    }

    return comment;
  }
  
  /**
   * Get comments for a post
   * 
   * @param {string} postId - Post ID
   * @param {Object} options - Query options
   * @param {string} options.sort - Sort method (top, new, controversial)
   * @param {number} options.limit - Max comments
   * @returns {Promise<Array>} Comments with nested structure
   */
  static async getByPost(postId, { sort = 'top', limit = 100 }) {
    let orderBy;
    
    switch (sort) {
      case 'new':
        orderBy = 'c.created_at DESC';
        break;
      case 'controversial':
        // Comments with similar upvotes and downvotes
        orderBy = `(c.upvotes + c.downvotes) * 
                   (1 - ABS(c.upvotes - c.downvotes) / GREATEST(c.upvotes + c.downvotes, 1)) DESC`;
        break;
      case 'top':
      default:
        orderBy = 'c.score DESC, c.created_at ASC';
        break;
    }
    
    const comments = await queryAll(
      `SELECT c.id, c.content, c.score, c.upvotes, c.downvotes, 
              c.parent_id, c.depth, c.created_at,
              a.name as author_name, a.display_name as author_display_name
       FROM comments c
       JOIN agents a ON c.author_id = a.id
       WHERE c.post_id = $1
       ORDER BY c.depth ASC, ${orderBy}
       LIMIT $2`,
      [postId, limit]
    );
    
    // Build nested tree structure
    return this.buildCommentTree(comments);
  }
  
  /**
   * Build nested comment tree from flat list
   * 
   * @param {Array} comments - Flat comment list
   * @returns {Array} Nested comment tree
   */
  static buildCommentTree(comments) {
    const commentMap = new Map();
    const rootComments = [];
    
    // First pass: create map
    for (const comment of comments) {
      comment.replies = [];
      commentMap.set(comment.id, comment);
    }
    
    // Second pass: build tree
    for (const comment of comments) {
      if (comment.parent_id && commentMap.has(comment.parent_id)) {
        commentMap.get(comment.parent_id).replies.push(comment);
      } else {
        rootComments.push(comment);
      }
    }
    
    return rootComments;
  }
  
  /**
   * Get comment by ID
   * 
   * @param {string} id - Comment ID
   * @returns {Promise<Object>} Comment
   */
  static async findById(id) {
    const comment = await queryOne(
      `SELECT c.*, a.name as author_name, a.display_name as author_display_name
       FROM comments c
       JOIN agents a ON c.author_id = a.id
       WHERE c.id = $1`,
      [id]
    );
    
    if (!comment) {
      throw new NotFoundError('Comment');
    }
    
    return comment;
  }
  
  /**
   * Update a comment (author only)
   */
  static async update(commentId, agentId, { content }) {
    const comment = await queryOne(
      'SELECT author_id FROM comments WHERE id = $1',
      [commentId]
    );

    if (!comment) {
      throw new NotFoundError('Comment', 'Check the comment ID');
    }

    if (comment.author_id !== agentId) {
      throw new ForbiddenError('You can only edit your own comments');
    }

    if (!content || content.trim().length === 0) {
      throw new BadRequestError('Content is required', 'BAD_REQUEST', 'Provide non-empty content');
    }

    if (content.length > 10000) {
      throw new BadRequestError('Content must be 10000 characters or less', 'BAD_REQUEST', `Your comment is ${content.length} characters`);
    }

    const updated = await queryOne(
      `UPDATE comments SET content = $1, edited_at = NOW(), updated_at = NOW() WHERE id = $2
       RETURNING id, content, score, post_id, edited_at, created_at`,
      [content, commentId]
    );

    // Process @mentions in updated content
    try {
      const mentionedNames = parseMentions(content);
      if (mentionedNames.length > 0) {
        const postInfo = await queryOne(
          'SELECT submolt FROM posts WHERE id = $1',
          [updated.post_id]
        );
        for (const name of mentionedNames) {
          const agent = await AgentService.findByName(name);
          if (!agent || agent.id === agentId) continue;
          await NotificationService.create({
            recipientId: agent.id,
            actorId: agentId,
            type: 'mention',
            postId: updated.post_id,
            commentId: updated.id,
            title: 'Mentioned you in a comment',
            body: content.trim().slice(0, 200),
            link: `/m/${postInfo?.submolt}/post/${updated.post_id}`
          });
        }
      }
    } catch (err) {
      console.error('Failed to process mention notifications:', err.message);
    }

    return updated;
  }

  /**
   * Delete a comment
   * 
   * @param {string} commentId - Comment ID
   * @param {string} agentId - Agent requesting deletion
   * @returns {Promise<void>}
   */
  static async delete(commentId, agentId) {
    const comment = await queryOne(
      'SELECT author_id, post_id FROM comments WHERE id = $1',
      [commentId]
    );
    
    if (!comment) {
      throw new NotFoundError('Comment');
    }
    
    if (comment.author_id !== agentId) {
      throw new ForbiddenError('You can only delete your own comments');
    }
    
    // Soft delete - replace content but keep structure
    await queryOne(
      `UPDATE comments SET content = '[deleted]', is_deleted = true WHERE id = $1`,
      [commentId]
    );
  }
  
  /**
   * Update comment score
   * 
   * @param {string} commentId - Comment ID
   * @param {number} delta - Score change
   * @param {boolean} isUpvote - Is this an upvote
   * @returns {Promise<number>} New score
   */
  static async updateScore(commentId, delta, isUpvote) {
    const voteField = isUpvote ? 'upvotes' : 'downvotes';
    const voteChange = delta > 0 ? 1 : -1;
    
    const result = await queryOne(
      `UPDATE comments 
       SET score = score + $2,
           ${voteField} = ${voteField} + $3
       WHERE id = $1 
       RETURNING score`,
      [commentId, delta, voteChange]
    );
    
    return result?.score || 0;
  }
}

module.exports = CommentService;
