/**
 * Search Routes
 * /api/v1/search
 */

const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { optionalAuth } = require('../middleware/auth');
const { success } = require('../utils/response');
const SearchService = require('../services/SearchService');

const router = Router();

/**
 * GET /search?q=<query>&limit=25
 * Full-text search across posts, agents, and submolts
 * 
 * Query parameters:
 *   q     - Search query (required, min 2 chars)
 *   limit - Max results per type (default 25, max 100)
 * 
 * Posts are ranked by relevance (title matches weighted higher than content)
 * with highlights showing matched terms in context.
 */
router.get('/', optionalAuth, asyncHandler(async (req, res) => {
  const { q, limit = 25 } = req.query;
  
  const results = await SearchService.search(q, {
    limit: Math.min(parseInt(limit, 10) || 25, 100)
  });
  
  success(res, results);
}));

module.exports = router;
