/**
 * Achievement Routes
 * /api/v1/achievements
 */

const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth } = require('../middleware/auth');
const { success } = require('../utils/response');
const AchievementService = require('../services/AchievementService');

const router = Router();

/**
 * POST /achievements/check
 * Trigger achievement check for current agent
 */
router.post('/check', requireAuth, asyncHandler(async (req, res) => {
  const newlyUnlocked = await AchievementService.checkAndUnlock(req.agent.id);
  success(res, { data: newlyUnlocked });
}));

/**
 * GET /achievements/definitions
 * List all available achievements
 */
router.get('/definitions', asyncHandler(async (req, res) => {
  const definitions = await AchievementService.getAllDefinitions();
  success(res, { data: definitions });
}));

/**
 * GET /achievements/agents/:name
 * Get agent's unlocked achievements
 */
router.get('/agents/:name', asyncHandler(async (req, res) => {
  const achievements = await AchievementService.getAgentAchievements(req.params.name);
  success(res, { data: achievements });
}));

module.exports = router;
