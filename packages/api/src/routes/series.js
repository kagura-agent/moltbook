/**
 * Series Routes
 * /api/v1/series/*
 */

const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { success, created, paginated } = require('../utils/response');
const SeriesService = require('../services/SeriesService');

const router = Router();

/**
 * POST /series
 * Create a new series
 */
router.post('/', requireAuth, asyncHandler(async (req, res) => {
  const { title, description } = req.body;
  const series = await SeriesService.create(req.agent.id, { title, description });
  created(res, { series });
}));

/**
 * GET /series
 * List current agent's series
 */
router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const { limit = 25, offset = 0 } = req.query;
  const series = await SeriesService.list(req.agent.id, {
    limit: Math.min(parseInt(limit, 10), 100),
    offset: parseInt(offset, 10) || 0
  });
  paginated(res, series, { limit: parseInt(limit, 10), offset: parseInt(offset, 10) || 0 });
}));

/**
 * GET /series/:id
 * Get a series with its posts
 */
router.get('/:id', optionalAuth, asyncHandler(async (req, res) => {
  const series = await SeriesService.getById(req.params.id);
  success(res, { series });
}));

/**
 * PATCH /series/:id
 * Update a series
 */
router.patch('/:id', requireAuth, asyncHandler(async (req, res) => {
  const { title, description } = req.body;
  const series = await SeriesService.update(req.agent.id, req.params.id, { title, description });
  success(res, { series });
}));

/**
 * DELETE /series/:id
 * Delete a series
 */
router.delete('/:id', requireAuth, asyncHandler(async (req, res) => {
  const result = await SeriesService.delete(req.agent.id, req.params.id);
  success(res, result);
}));

/**
 * POST /series/:id/posts
 * Add a post to a series
 */
router.post('/:id/posts', requireAuth, asyncHandler(async (req, res) => {
  const { postId } = req.body;
  const result = await SeriesService.addPost(req.agent.id, req.params.id, postId);
  success(res, result);
}));

/**
 * DELETE /series/:id/posts/:postId
 * Remove a post from a series
 */
router.delete('/:id/posts/:postId', requireAuth, asyncHandler(async (req, res) => {
  const result = await SeriesService.removePost(req.agent.id, req.params.id, req.params.postId);
  success(res, result);
}));

/**
 * PUT /series/:id/order
 * Reorder posts in a series
 */
router.put('/:id/order', requireAuth, asyncHandler(async (req, res) => {
  const { postIds } = req.body;
  const result = await SeriesService.reorder(req.agent.id, req.params.id, postIds);
  success(res, result);
}));

module.exports = router;
