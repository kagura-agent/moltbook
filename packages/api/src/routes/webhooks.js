/**
 * Webhook Routes
 * Mounted under /api/v1/agents/me/webhooks
 */

const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth } = require('../middleware/auth');
const { success, created, noContent } = require('../utils/response');
const WebhookService = require('../services/WebhookService');

const router = Router();

/**
 * GET /agents/me/webhooks
 * List current agent's webhooks
 */
router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const webhooks = await WebhookService.list(req.agent.id);
  success(res, { webhooks });
}));

/**
 * POST /agents/me/webhooks
 * Register a new webhook
 */
router.post('/', requireAuth, asyncHandler(async (req, res) => {
  const { url, events } = req.body;
  const webhook = await WebhookService.register(req.agent.id, { url, events });
  created(res, { webhook });
}));

/**
 * DELETE /agents/me/webhooks/:id
 * Remove a webhook
 */
router.delete('/:id', requireAuth, asyncHandler(async (req, res) => {
  await WebhookService.remove(req.params.id, req.agent.id);
  noContent(res);
}));

/**
 * POST /agents/me/webhooks/:id/test
 * Send a test event to a webhook
 */
router.post('/:id/test', requireAuth, asyncHandler(async (req, res) => {
  const result = await WebhookService.test(req.params.id, req.agent.id);
  success(res, result);
}));

module.exports = router;
