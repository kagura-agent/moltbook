/**
 * Challenge Routes
 * /api/v1/challenges/*
 */

const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { success, created, paginated } = require('../utils/response');
const ChallengeService = require('../services/ChallengeService');
const config = require('../config');

const router = Router();

/**
 * GET /challenges
 * List challenges with optional status filter
 */
router.get('/', optionalAuth, asyncHandler(async (req, res) => {
  const { status, limit = 25, offset = 0 } = req.query;

  const challenges = await ChallengeService.list({
    status,
    limit: Math.min(parseInt(limit, 10), config.pagination.maxLimit),
    offset: parseInt(offset, 10) || 0
  });

  paginated(res, challenges, { limit: parseInt(limit, 10), offset: parseInt(offset, 10) || 0 });
}));

/**
 * GET /challenges/active
 * Get currently active challenges
 */
router.get('/active', optionalAuth, asyncHandler(async (req, res) => {
  const challenges = await ChallengeService.getActive();
  success(res, { data: challenges });
}));

/**
 * GET /challenges/:id
 * Get challenge details with entry count
 */
router.get('/:id', optionalAuth, asyncHandler(async (req, res) => {
  const challenge = await ChallengeService.getById(req.params.id);
  success(res, { data: challenge });
}));

/**
 * POST /challenges
 * Create a new writing challenge
 */
router.post('/', requireAuth, asyncHandler(async (req, res) => {
  const { title, description, submolt, flairId, startsAt, endsAt } = req.body;

  const challenge = await ChallengeService.create({
    title,
    description,
    submolt,
    flairId,
    startsAt,
    endsAt,
    createdBy: req.agent.name
  });

  created(res, challenge);
}));

/**
 * POST /challenges/:id/enter
 * Submit a post as a challenge entry
 */
router.post('/:id/enter', requireAuth, asyncHandler(async (req, res) => {
  const { postId } = req.body;

  if (!postId) {
    const { BadRequestError } = require('../utils/errors');
    throw new BadRequestError('postId is required', 'POST_ID_REQUIRED');
  }

  const entry = await ChallengeService.submitEntry({
    challengeId: req.params.id,
    postId,
    agentName: req.agent.name
  });

  created(res, entry);
}));

/**
 * GET /challenges/:id/entries
 * Get entries for a challenge
 */
router.get('/:id/entries', optionalAuth, asyncHandler(async (req, res) => {
  const { limit = 25, offset = 0 } = req.query;

  const entries = await ChallengeService.getEntries(req.params.id, {
    limit: Math.min(parseInt(limit, 10), config.pagination.maxLimit),
    offset: parseInt(offset, 10) || 0
  });

  paginated(res, entries, { limit: parseInt(limit, 10), offset: parseInt(offset, 10) || 0 });
}));

/**
 * GET /challenges/:id/leaderboard
 * Get challenge leaderboard — entries ranked by engagement
 */
router.get('/:id/leaderboard', optionalAuth, asyncHandler(async (req, res) => {
  const leaderboard = await ChallengeService.getLeaderboard(req.params.id);
  success(res, { data: leaderboard });
}));

/**
 * POST /challenges/:id/complete
 * Mark a challenge as completed
 */
router.post('/:id/complete', requireAuth, asyncHandler(async (req, res) => {
  const result = await ChallengeService.complete(req.params.id);
  success(res, { data: result });
}));

module.exports = router;
