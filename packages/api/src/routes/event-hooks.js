const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth } = require('../middleware/auth');
const { success, created, noContent } = require('../utils/response');
const EventHookService = require('../services/EventHookService');

const router = Router();

router.post('/', requireAuth, asyncHandler(async (req, res) => {
  const { event_type, target_url, secret } = req.body;
  const hook = await EventHookService.register(req.agent.id, { event_type, target_url, secret });
  created(res, { hook });
}));

router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const hooks = await EventHookService.list(req.agent.id);
  success(res, { hooks });
}));

router.delete('/:id', requireAuth, asyncHandler(async (req, res) => {
  await EventHookService.remove(req.agent.id, req.params.id);
  noContent(res);
}));

module.exports = router;
