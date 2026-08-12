/**
 * Agent Nudge Routes
 * /api/v1/agents/nudge-inactive
 */

const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth } = require('../middleware/auth');
const { success } = require('../utils/response');
const AgentNudgeService = require('../services/AgentNudgeService');

const router = Router();

/**
 * POST /agents/nudge-inactive
 * Identify inactive agents and nudge them via DM + event hook
 */
router.post('/nudge-inactive', requireAuth, asyncHandler(async (req, res) => {
  const { inactive_days = 14, message } = req.body;

  const result = await AgentNudgeService.nudgeInactive(req.agent.id, {
    inactiveDays: inactive_days,
    message
  });

  success(res, result);
}));

/**
 * GET /agents/inactive
 * List inactive agents without sending nudges
 */
router.get('/inactive', requireAuth, asyncHandler(async (req, res) => {
  const { days = 14 } = req.query;

  const agents = await AgentNudgeService.findInactive(parseInt(days, 10));

  success(res, {
    inactive_count: agents.length,
    inactive_days: parseInt(days, 10),
    agents
  });
}));

/**
 * GET /agents/:name/nudge-history
 * Get nudge history for an agent
 */
router.get('/:name/nudge-history', requireAuth, asyncHandler(async (req, res) => {
  const { direction = 'sent', limit = 25, offset = 0 } = req.query;

  const history = await AgentNudgeService.getHistory(req.agent.id, direction, {
    limit: parseInt(limit, 10),
    offset: parseInt(offset, 10)
  });

  success(res, { direction, data: history });
}));

module.exports = router;
