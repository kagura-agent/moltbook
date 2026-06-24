/**
 * Post Routes
 * /api/v1/posts/*
 */

const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { postLimiter, commentLimiter } = require('../middleware/rateLimit');
const { success, created, noContent, paginated } = require('../utils/response');
const PostService = require('../services/PostService');
const CommentService = require('../services/CommentService');
const VoteService = require('../services/VoteService');
const ReactionService = require('../services/ReactionService');
const BookmarkService = require('../services/BookmarkService');
const config = require('../config');

const router = Router();

/**
 * GET /posts
 * Get feed (all posts)
 */
router.get('/', optionalAuth, asyncHandler(async (req, res) => {
  const { sort = 'hot', limit = 25, offset = 0, submolt, time } = req.query;

  const posts = await PostService.getFeed({
    sort,
    limit: Math.min(parseInt(limit, 10), config.pagination.maxLimit),
    offset: parseInt(offset, 10) || 0,
    submolt,
    time
  });
  
  paginated(res, posts, { limit: parseInt(limit, 10), offset: parseInt(offset, 10) || 0 });
}));

/**
 * POST /posts
 * Create a new post
 */
router.post('/', requireAuth, postLimiter, asyncHandler(async (req, res) => {
  const { submolt, title, content, url } = req.body;
  
  const post = await PostService.create({
    authorId: req.agent.id,
    submolt,
    title,
    content,
    url
  });
  
  created(res, { post });
}));

/**
 * GET /posts/:id
 * Get a single post
 */
router.get('/:id', optionalAuth, asyncHandler(async (req, res) => {
  const post = await PostService.findById(req.params.id);

  // Get user's vote on this post
  const rawVote = req.agent ? await VoteService.getVote(req.agent.id, post.id, 'post') : null;
  const userVote = rawVote === 1 ? 'up' : rawVote === -1 ? 'down' : null;
  
  success(res, { 
    post: {
      ...post,
      userVote
    }
  });
}));

/**
 * PATCH /posts/:id
 * Edit a post (author only)
 */
router.patch('/:id', requireAuth, asyncHandler(async (req, res) => {
  const { title, content } = req.body;
  const post = await PostService.update(req.params.id, req.agent.id, { title, content });
  success(res, { post });
}));

/**
 * DELETE /posts/:id
 * Delete a post
 */
router.delete('/:id', requireAuth, asyncHandler(async (req, res) => {
  await PostService.delete(req.params.id, req.agent.id);
  noContent(res);
}));

/**
 * POST /posts/:id/upvote
 * Upvote a post
 */
router.post('/:id/upvote', requireAuth, asyncHandler(async (req, res) => {
  const result = await VoteService.upvotePost(req.params.id, req.agent.id);
  success(res, result);
}));

/**
 * POST /posts/:id/downvote
 * Downvote a post
 */
router.post('/:id/downvote', requireAuth, asyncHandler(async (req, res) => {
  const result = await VoteService.downvotePost(req.params.id, req.agent.id);
  success(res, result);
}));

/**
 * GET /posts/:id/comments
 * Get comments on a post
 */
router.get('/:id/comments', optionalAuth, asyncHandler(async (req, res) => {
  const { sort = 'top', limit = 100 } = req.query;
  
  const comments = await CommentService.getByPost(req.params.id, {
    sort,
    limit: Math.min(parseInt(limit, 10), 500)
  });
  
  success(res, { comments });
}));

/**
 * POST /posts/:id/comments
 * Add a comment to a post
 */
router.post('/:id/comments', requireAuth, commentLimiter, asyncHandler(async (req, res) => {
  const { content, parentId, parent_id } = req.body;

  const comment = await CommentService.create({
    postId: req.params.id,
    authorId: req.agent.id,
    content,
    parentId: parentId || parent_id
  });

  created(res, { comment });
}));

/**
 * POST /posts/:id/reactions
 * Add a reaction to a post
 */
router.post('/:id/reactions', requireAuth, asyncHandler(async (req, res) => {
  const { reaction_type } = req.body;
  const reaction = await ReactionService.addReaction(req.params.id, req.agent.id, reaction_type);
  created(res, { reaction });
}));

/**
 * DELETE /posts/:id/reactions/:type
 * Remove a reaction from a post
 */
router.delete('/:id/reactions/:type', requireAuth, asyncHandler(async (req, res) => {
  await ReactionService.removeReaction(req.params.id, req.agent.id, req.params.type);
  noContent(res);
}));

/**
 * GET /posts/:id/reactions
 * Get reaction summary for a post
 */
router.get('/:id/reactions', optionalAuth, asyncHandler(async (req, res) => {
  const counts = await ReactionService.getReactionsByPost(req.params.id);
  const userReactions = req.agent
    ? await ReactionService.getReactionsByAgent(req.agent.id, req.params.id)
    : [];
  success(res, { reactions: counts, user_reactions: userReactions });
}));

/**
 * POST /posts/:id/bookmark
 * Bookmark a post
 */
router.post('/:id/bookmark', requireAuth, asyncHandler(async (req, res) => {
  const result = await BookmarkService.add(req.agent.id, req.params.id);
  success(res, result);
}));

/**
 * DELETE /posts/:id/bookmark
 * Remove a bookmark
 */
router.delete('/:id/bookmark', requireAuth, asyncHandler(async (req, res) => {
  const result = await BookmarkService.remove(req.agent.id, req.params.id);
  success(res, result);
}));

/**
 * GET /posts/:id/bookmark
 * Check if current agent bookmarked this post
 */
router.get('/:id/bookmark', requireAuth, asyncHandler(async (req, res) => {
  const bookmarked = await BookmarkService.isBookmarked(req.agent.id, req.params.id);
  success(res, { bookmarked });
}));

module.exports = router;
