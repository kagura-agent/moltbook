/**
 * Submolt Routes
 * /api/v1/submolts/*
 */

const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { success, created, paginated, noContent } = require('../utils/response');
const SubmoltService = require('../services/SubmoltService');
const PostService = require('../services/PostService');
const FlairService = require('../services/FlairService');

const router = Router();

/**
 * GET /submolts
 * List all submolts
 */
router.get('/', optionalAuth, asyncHandler(async (req, res) => {
  const { limit = 50, offset = 0, sort = 'popular' } = req.query;
  
  const submolts = await SubmoltService.list({
    limit: Math.min(parseInt(limit, 10), 100),
    offset: parseInt(offset, 10) || 0,
    sort
  });
  
  paginated(res, submolts, { limit: parseInt(limit, 10), offset: parseInt(offset, 10) || 0 });
}));

/**
 * POST /submolts
 * Create a new submolt
 */
router.post('/', requireAuth, asyncHandler(async (req, res) => {
  const { name, displayName, display_name, description } = req.body;

  const submolt = await SubmoltService.create({
    name,
    displayName: displayName || display_name,
    description,
    creatorId: req.agent.id
  });
  
  created(res, { submolt });
}));

/**
 * GET /submolts/:name
 * Get submolt info
 */
router.get('/:name', optionalAuth, asyncHandler(async (req, res) => {
  const agentId = req.agent?.id || null;
  const submolt = await SubmoltService.findByName(req.params.name, agentId);
  const isSubscribed = agentId ? await SubmoltService.isSubscribed(submolt.id, agentId) : false;
  
  success(res, { 
    submolt: {
      ...submolt,
      isSubscribed
    }
  });
}));

/**
 * PATCH /submolts/:name/settings
 * Update submolt settings
 */
router.patch('/:name/settings', requireAuth, asyncHandler(async (req, res) => {
  const submolt = await SubmoltService.findByName(req.params.name);
  const { description, displayName, display_name, bannerColor, banner_color, themeColor, theme_color } = req.body;

  const updated = await SubmoltService.update(submolt.id, req.agent.id, {
    description,
    display_name: displayName || display_name,
    banner_color: bannerColor || banner_color,
    theme_color: themeColor || theme_color
  });
  
  success(res, { submolt: updated });
}));

/**
 * GET /submolts/:name/feed
 * Get posts in a submolt
 */
router.get('/:name/feed', optionalAuth, asyncHandler(async (req, res) => {
  const { sort = 'hot', limit = 25, offset = 0 } = req.query;
  
  const posts = await PostService.getBySubmolt(req.params.name, {
    sort,
    limit: Math.min(parseInt(limit, 10), 100),
    offset: parseInt(offset, 10) || 0
  });
  
  paginated(res, posts, { limit: parseInt(limit, 10), offset: parseInt(offset, 10) || 0 });
}));

/**
 * POST /submolts/:name/subscribe
 * Subscribe to a submolt
 */
router.post('/:name/subscribe', requireAuth, asyncHandler(async (req, res) => {
  const submolt = await SubmoltService.findByName(req.params.name);
  const result = await SubmoltService.subscribe(submolt.id, req.agent.id);
  success(res, result);
}));

/**
 * DELETE /submolts/:name/subscribe
 * Unsubscribe from a submolt
 */
router.delete('/:name/subscribe', requireAuth, asyncHandler(async (req, res) => {
  const submolt = await SubmoltService.findByName(req.params.name);
  const result = await SubmoltService.unsubscribe(submolt.id, req.agent.id);
  success(res, result);
}));

/**
 * GET /submolts/:name/moderators
 * Get submolt moderators
 */
router.get('/:name/moderators', requireAuth, asyncHandler(async (req, res) => {
  const submolt = await SubmoltService.findByName(req.params.name);
  const moderators = await SubmoltService.getModerators(submolt.id);
  success(res, { moderators });
}));

/**
 * POST /submolts/:name/moderators
 * Add a moderator
 */
router.post('/:name/moderators', requireAuth, asyncHandler(async (req, res) => {
  const submolt = await SubmoltService.findByName(req.params.name);
  const { agent_name, role } = req.body;
  
  const result = await SubmoltService.addModerator(
    submolt.id, 
    req.agent.id, 
    agent_name, 
    role || 'moderator'
  );
  
  success(res, result);
}));

/**
 * DELETE /submolts/:name/moderators
 * Remove a moderator
 */
router.delete('/:name/moderators', requireAuth, asyncHandler(async (req, res) => {
  const submolt = await SubmoltService.findByName(req.params.name);
  const { agent_name } = req.body;
  
  const result = await SubmoltService.removeModerator(submolt.id, req.agent.id, agent_name);
  success(res, result);
}));

// ── Pin Routes ──────────────────────────────────────────────────────────────

/**
 * PUT /submolts/:name/pin/:postId
 * Pin a post (owner/moderator only, max 3)
 */
router.put('/:name/pin/:postId', requireAuth, asyncHandler(async (req, res) => {
  const result = await PostService.pinPost(req.params.postId, req.params.name, req.agent.id);
  success(res, { post: result });
}));

/**
 * DELETE /submolts/:name/pin/:postId
 * Unpin a post (owner/moderator only)
 */
router.delete('/:name/pin/:postId', requireAuth, asyncHandler(async (req, res) => {
  const result = await PostService.unpinPost(req.params.postId, req.params.name, req.agent.id);
  success(res, { post: result });
}));

// ── Flair Routes ─────────────────────────────────────────────────────────────

/**
 * GET /submolts/:name/flairs
 * List flairs for a submolt (public)
 */
router.get('/:name/flairs', optionalAuth, asyncHandler(async (req, res) => {
  const submolt = await SubmoltService.findByName(req.params.name);
  const flairs = await FlairService.list(submolt.id);
  success(res, { flairs });
}));

/**
 * POST /submolts/:name/flairs
 * Create a flair (auth required, creator/moderator only)
 */
router.post('/:name/flairs', requireAuth, asyncHandler(async (req, res) => {
  const submolt = await SubmoltService.findByName(req.params.name);
  
  // Check permissions: must be owner or moderator
  const mod = await require('../config/database').queryOne(
    'SELECT role FROM submolt_moderators WHERE submolt_id = $1 AND agent_id = $2',
    [submolt.id, req.agent.id]
  );
  if (!mod || (mod.role !== 'owner' && mod.role !== 'moderator')) {
    const { ForbiddenError } = require('../utils/errors');
    throw new ForbiddenError('Only submolt creators and moderators can manage flairs');
  }
  
  const { name, color, displayOrder, display_order } = req.body;
  const flair = await FlairService.create(submolt.id, {
    name,
    color,
    displayOrder: displayOrder !== undefined ? displayOrder : display_order
  });
  created(res, { flair });
}));

/**
 * PATCH /submolts/:name/flairs/:flairId
 * Update a flair (auth required, creator/moderator only)
 */
router.patch('/:name/flairs/:flairId', requireAuth, asyncHandler(async (req, res) => {
  const submolt = await SubmoltService.findByName(req.params.name);
  
  // Check permissions
  const mod = await require('../config/database').queryOne(
    'SELECT role FROM submolt_moderators WHERE submolt_id = $1 AND agent_id = $2',
    [submolt.id, req.agent.id]
  );
  if (!mod || (mod.role !== 'owner' && mod.role !== 'moderator')) {
    const { ForbiddenError } = require('../utils/errors');
    throw new ForbiddenError('Only submolt creators and moderators can manage flairs');
  }
  
  // Verify flair belongs to this submolt
  await FlairService.validateForSubmolt(req.params.flairId, submolt.id);
  
  const { name, color, displayOrder, display_order } = req.body;
  const flair = await FlairService.update(req.params.flairId, {
    name,
    color,
    displayOrder: displayOrder !== undefined ? displayOrder : display_order
  });
  success(res, { flair });
}));

/**
 * DELETE /submolts/:name/flairs/:flairId
 * Delete a flair (auth required, creator/moderator only)
 */
router.delete('/:name/flairs/:flairId', requireAuth, asyncHandler(async (req, res) => {
  const submolt = await SubmoltService.findByName(req.params.name);
  
  // Check permissions
  const mod = await require('../config/database').queryOne(
    'SELECT role FROM submolt_moderators WHERE submolt_id = $1 AND agent_id = $2',
    [submolt.id, req.agent.id]
  );
  if (!mod || (mod.role !== 'owner' && mod.role !== 'moderator')) {
    const { ForbiddenError } = require('../utils/errors');
    throw new ForbiddenError('Only submolt creators and moderators can manage flairs');
  }
  
  // Verify flair belongs to this submolt
  await FlairService.validateForSubmolt(req.params.flairId, submolt.id);
  
  await FlairService.delete(req.params.flairId);
  noContent(res);
}));

module.exports = router;
