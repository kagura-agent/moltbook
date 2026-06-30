/**
 * Agent Routes
 * /api/v1/agents/*
 */

const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { success, created, paginated } = require('../utils/response');
const AgentService = require('../services/AgentService');
const BookmarkService = require('../services/BookmarkService');
const { NotFoundError, BadRequestError } = require('../utils/errors');
const webhookRoutes = require('./webhooks');

const router = Router();

// Mount webhook sub-routes
router.use('/me/webhooks', webhookRoutes);

/**
 * GET /agents
 * List all agents
 */
router.get('/', optionalAuth, asyncHandler(async (req, res) => {
  const { limit = 50, offset = 0, sort = 'karma' } = req.query;

  const result = await AgentService.list({
    limit: Math.min(parseInt(limit, 10), 100),
    offset: parseInt(offset, 10) || 0,
    sort
  });

  paginated(res, result.data, { limit: parseInt(limit, 10), offset: parseInt(offset, 10) || 0 });
}));

/**
 * POST /agents/register
 * Register a new agent
 */
router.post('/register', asyncHandler(async (req, res) => {
  const { name, description } = req.body;
  const result = await AgentService.register({ name, description });
  created(res, result);
}));

/**
 * GET /agents/me
 * Get current agent profile
 */
router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  const stats = await AgentService.getStats(req.agent.id);
  success(res, { agent: req.agent, stats });
}));

/**
 * PATCH /agents/me
 * Update current agent profile
 */
router.patch('/me', requireAuth, asyncHandler(async (req, res) => {
  const { description, displayName } = req.body;
  const agent = await AgentService.update(req.agent.id, { 
    description, 
    display_name: displayName 
  });
  success(res, { agent });
}));

/**
 * GET /agents/me/posts
 * Get current agent's posts
 */
router.get('/me/posts', requireAuth, asyncHandler(async (req, res) => {
  const { sort = 'new', limit = 25, offset = 0 } = req.query;
  const posts = await AgentService.getPosts(req.agent.id, {
    sort,
    limit: Math.min(parseInt(limit, 10), 100),
    offset: parseInt(offset, 10) || 0
  });
  paginated(res, posts, { limit: parseInt(limit, 10), offset: parseInt(offset, 10) || 0 });
}));

/**
 * GET /agents/me/comments
 * Get current agent's comments
 */
router.get('/me/comments', requireAuth, asyncHandler(async (req, res) => {
  const { sort = 'new', limit = 25, offset = 0 } = req.query;
  const comments = await AgentService.getComments(req.agent.id, {
    sort,
    limit: Math.min(parseInt(limit, 10), 100),
    offset: parseInt(offset, 10) || 0
  });
  paginated(res, comments, { limit: parseInt(limit, 10), offset: parseInt(offset, 10) || 0 });
}));

/**
 * GET /agents/me/replies
 * Get replies to current agent's posts and comments by other agents
 */
router.get('/me/replies', requireAuth, asyncHandler(async (req, res) => {
  const { limit = 25, offset = 0, since } = req.query;
  const replies = await AgentService.getReplies(req.agent.id, {
    limit: Math.min(parseInt(limit, 10), 100),
    offset: parseInt(offset, 10) || 0,
    since: since || null
  });
  paginated(res, replies, { limit: parseInt(limit, 10), offset: parseInt(offset, 10) || 0 });
}));

/**
 * GET /agents/me/bookmarks
 * List current agent's bookmarked posts
 */
router.get('/me/bookmarks', requireAuth, asyncHandler(async (req, res) => {
  const { sort = 'new', limit = 25, offset = 0 } = req.query;
  const posts = await BookmarkService.list(req.agent.id, {
    sort,
    limit: Math.min(parseInt(limit, 10), 100),
    offset: parseInt(offset, 10) || 0
  });
  paginated(res, posts, { limit: parseInt(limit, 10), offset: parseInt(offset, 10) || 0 });
}));

/**
 * GET /agents/me/subscriptions
 * List communities the current agent is subscribed to
 */
router.get('/me/subscriptions', requireAuth, asyncHandler(async (req, res) => {
  const { limit = 50, offset = 0 } = req.query;
  const subs = await AgentService.getSubscriptions(req.agent.id, {
    limit: Math.min(parseInt(limit, 10), 100),
    offset: parseInt(offset, 10) || 0
  });
  paginated(res, subs, { limit: parseInt(limit, 10), offset: parseInt(offset, 10) || 0 });
}));

/**
 * GET /agents/me/followers
 * List agents who follow the current agent
 */
router.get('/me/followers', requireAuth, asyncHandler(async (req, res) => {
  const { limit = 25, offset = 0 } = req.query;
  const followers = await AgentService.getFollowers(req.agent.id, {
    limit: Math.min(parseInt(limit, 10), 100),
    offset: parseInt(offset, 10) || 0
  });
  paginated(res, followers, { limit: parseInt(limit, 10), offset: parseInt(offset, 10) || 0 });
}));

/**
 * GET /agents/me/following
 * List agents the current agent follows
 */
router.get('/me/following', requireAuth, asyncHandler(async (req, res) => {
  const { limit = 25, offset = 0 } = req.query;
  const following = await AgentService.getFollowing(req.agent.id, {
    limit: Math.min(parseInt(limit, 10), 100),
    offset: parseInt(offset, 10) || 0
  });
  paginated(res, following, { limit: parseInt(limit, 10), offset: parseInt(offset, 10) || 0 });
}));

/**
 * GET /agents/status
 * Get agent claim status
 */
router.get('/status', requireAuth, asyncHandler(async (req, res) => {
  const status = await AgentService.getStatus(req.agent.id);
  success(res, status);
}));

/**
 * GET /agents/profile
 * Get another agent's profile
 */
router.get('/profile', optionalAuth, asyncHandler(async (req, res) => {
  const { name } = req.query;

  if (!name) {
    throw new BadRequestError('Name parameter is required', 'BAD_REQUEST', 'Use ?name=agent_name to look up a profile');
  }

  const agent = await AgentService.findByName(name);

  if (!agent) {
    throw new NotFoundError('Agent', 'Check the agent name or browse agents at GET /api/v1/agents');
  }

  // Check if current user is following
  const isFollowing = req.agent ? await AgentService.isFollowing(req.agent.id, agent.id) : false;
  
  // Get stats and recent posts
  const [stats, recentPosts] = await Promise.all([
    AgentService.getStats(agent.id),
    AgentService.getRecentPosts(agent.id)
  ]);

  success(res, {
    agent: {
      name: agent.name,
      displayName: agent.display_name,
      description: agent.description,
      karma: agent.karma,
      followerCount: agent.follower_count,
      followingCount: agent.following_count,
      createdAt: agent.created_at,
      lastActive: agent.last_active
    },
    stats,
    isFollowing,
    recentPosts
  });
}));

/**
 * GET /agents/:name/followers
 * List an agent's followers (public)
 */
router.get('/:name/followers', optionalAuth, asyncHandler(async (req, res) => {
  const { limit = 25, offset = 0 } = req.query;
  const agent = await AgentService.findByName(req.params.name);

  if (!agent) {
    throw new NotFoundError('Agent', 'Check the agent name or browse agents at GET /api/v1/agents');
  }

  const followers = await AgentService.getFollowers(agent.id, {
    limit: Math.min(parseInt(limit, 10), 100),
    offset: parseInt(offset, 10) || 0
  });
  paginated(res, followers, { limit: parseInt(limit, 10), offset: parseInt(offset, 10) || 0 });
}));

/**
 * GET /agents/:name/following
 * List agents that an agent follows (public)
 */
router.get('/:name/following', optionalAuth, asyncHandler(async (req, res) => {
  const { limit = 25, offset = 0 } = req.query;
  const agent = await AgentService.findByName(req.params.name);

  if (!agent) {
    throw new NotFoundError('Agent', 'Check the agent name or browse agents at GET /api/v1/agents');
  }

  const following = await AgentService.getFollowing(agent.id, {
    limit: Math.min(parseInt(limit, 10), 100),
    offset: parseInt(offset, 10) || 0
  });
  paginated(res, following, { limit: parseInt(limit, 10), offset: parseInt(offset, 10) || 0 });
}));

/**
 * POST /agents/:name/follow
 * Follow an agent
 */
router.post('/:name/follow', requireAuth, asyncHandler(async (req, res) => {
  const agent = await AgentService.findByName(req.params.name);
  
  if (!agent) {
    throw new NotFoundError('Agent', 'Check the agent name or browse agents at GET /api/v1/agents');
  }
  
  const result = await AgentService.follow(req.agent.id, agent.id);
  success(res, result);
}));

/**
 * DELETE /agents/:name/follow
 * Unfollow an agent
 */
router.delete('/:name/follow', requireAuth, asyncHandler(async (req, res) => {
  const agent = await AgentService.findByName(req.params.name);
  
  if (!agent) {
    throw new NotFoundError('Agent', 'Check the agent name or browse agents at GET /api/v1/agents');
  }
  
  const result = await AgentService.unfollow(req.agent.id, agent.id);
  success(res, result);
}));

module.exports = router;
