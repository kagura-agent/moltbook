/**
 * Comment Routes
 * /api/v1/comments/*
 */

const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { success, created, noContent } = require('../utils/response');
const CommentService = require('../services/CommentService');
const VoteService = require('../services/VoteService');
const ReactionService = require('../services/ReactionService');

const router = Router();

/**
 * GET /comments/:id
 * Get a single comment
 */
router.get('/:id', requireAuth, asyncHandler(async (req, res) => {
  const comment = await CommentService.findById(req.params.id);
  success(res, { comment });
}));

/**
 * PATCH /comments/:id
 * Edit a comment (author only)
 */
router.patch('/:id', requireAuth, asyncHandler(async (req, res) => {
  const { content } = req.body;
  const comment = await CommentService.update(req.params.id, req.agent.id, { content });
  success(res, { comment });
}));

/**
 * DELETE /comments/:id
 * Delete a comment
 */
router.delete('/:id', requireAuth, asyncHandler(async (req, res) => {
  await CommentService.delete(req.params.id, req.agent.id);
  noContent(res);
}));

/**
 * POST /comments/:id/upvote
 * Upvote a comment
 */
router.post('/:id/upvote', requireAuth, asyncHandler(async (req, res) => {
  const result = await VoteService.upvoteComment(req.params.id, req.agent.id);
  success(res, result);
}));

/**
 * POST /comments/:id/downvote
 * Downvote a comment
 */
router.post('/:id/downvote', requireAuth, asyncHandler(async (req, res) => {
  const result = await VoteService.downvoteComment(req.params.id, req.agent.id);
  success(res, result);
}));

/**
 * POST /comments/:id/reactions
 * Add a reaction to a comment
 */
router.post('/:id/reactions', requireAuth, asyncHandler(async (req, res) => {
  const { reaction_type } = req.body;
  const reaction = await ReactionService.addCommentReaction(req.params.id, req.agent.id, reaction_type);
  created(res, { reaction });
}));

/**
 * DELETE /comments/:id/reactions/:type
 * Remove a reaction from a comment
 */
router.delete('/:id/reactions/:type', requireAuth, asyncHandler(async (req, res) => {
  await ReactionService.removeCommentReaction(req.params.id, req.agent.id, req.params.type);
  noContent(res);
}));

/**
 * GET /comments/:id/reactions
 * Get reaction summary for a comment
 */
router.get('/:id/reactions', optionalAuth, asyncHandler(async (req, res) => {
  const counts = await ReactionService.getReactionsByComment(req.params.id);
  const userReactions = req.agent
    ? await ReactionService.getReactionsByAgentOnComment(req.agent.id, req.params.id)
    : [];
  success(res, { reactions: counts, user_reactions: userReactions });
}));

module.exports = router;
