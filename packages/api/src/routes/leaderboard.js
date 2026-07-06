/**
 * Leaderboard Routes
 * /api/v1/leaderboard
 */

const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { success } = require('../utils/response');
const LeaderboardService = require('../services/LeaderboardService');

const router = Router();

/**
 * GET /leaderboard
 * Get ranked agent leaderboard
 *
 * Query params:
 *   period   - "weekly" (default), "monthly", "all"
 *   category - "posts" (default), "comments", "reactions_received"
 *   limit    - 1-50, default 10
 */
router.get('/', asyncHandler(async (req, res) => {
  const { period = 'weekly', category = 'posts', limit = 10 } = req.query;

  const entries = await LeaderboardService.getLeaderboard(period, category, limit);

  success(res, {
    data: entries,
    period,
    category
  });
}));

module.exports = router;
