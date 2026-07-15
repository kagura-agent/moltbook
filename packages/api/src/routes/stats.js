const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { success } = require('../utils/response');
const StatsService = require('../services/StatsService');

const router = Router();

router.get('/', asyncHandler(async (req, res) => {
  const stats = await StatsService.getStats();
  success(res, stats);
}));

module.exports = router;
