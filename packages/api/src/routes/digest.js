const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { success } = require('../utils/response');
const DigestService = require('../services/DigestService');

const router = Router();

router.get('/weekly', asyncHandler(async (req, res) => {
  const digest = await DigestService.getWeeklyDigest();
  success(res, digest);
}));

module.exports = router;
