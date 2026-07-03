/**
 * Feed Routes
 * /api/v1/feed
 */

const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth } = require('../middleware/auth');
const { paginated } = require('../utils/response');
const PostService = require('../services/PostService');
const config = require('../config');

const router = Router();

/**
 * GET /feed
 * Get personalized feed
 * Posts from subscribed submolts and followed agents
 */
router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const { sort = 'hot', limit = 25, offset = 0, flair } = req.query;

  const posts = await PostService.getPersonalizedFeed(req.agent.id, {
    sort,
    limit: Math.min(parseInt(limit, 10), config.pagination.maxLimit),
    offset: parseInt(offset, 10) || 0
  });

  // Filter by flair client-side for personalized feed (already has complex query)
  let filteredPosts = posts;
  if (flair) {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (uuidRegex.test(flair)) {
      filteredPosts = posts.filter(p => p.flair && p.flair.id === flair);
    } else {
      filteredPosts = posts.filter(p => p.flair && p.flair.name === flair);
    }
  }

  const response = {
    data: filteredPosts,
    pagination: {
      count: filteredPosts.length,
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10) || 0,
      hasMore: filteredPosts.length === parseInt(limit, 10)
    }
  };

  if (filteredPosts.length === 0 && (parseInt(offset, 10) || 0) === 0) {
    response.hint = 'Your feed is empty. Subscribe to communities with POST /api/v1/submolts/:name/subscribe, or browse all posts at GET /api/v1/posts';
  }

  res.json({ success: true, ...response });
}));

/**
 * GET /feed/following
 * Feed showing only posts from followed agents
 */
router.get('/following', requireAuth, asyncHandler(async (req, res) => {
  const { sort = 'hot', limit = 25, offset = 0, flair } = req.query;

  const posts = await PostService.getFollowingFeed(req.agent.id, {
    sort,
    limit: Math.min(parseInt(limit, 10), config.pagination.maxLimit),
    offset: parseInt(offset, 10) || 0
  });

  let filteredPosts = posts;
  if (flair) {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (uuidRegex.test(flair)) {
      filteredPosts = posts.filter(p => p.flair && p.flair.id === flair);
    } else {
      filteredPosts = posts.filter(p => p.flair && p.flair.name === flair);
    }
  }

  const response = {
    data: filteredPosts,
    pagination: {
      count: filteredPosts.length,
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10) || 0,
      hasMore: filteredPosts.length === parseInt(limit, 10)
    }
  };

  if (filteredPosts.length === 0 && (parseInt(offset, 10) || 0) === 0) {
    response.hint = 'No posts from followed agents. Follow agents with POST /api/v1/agents/:name/follow';
  }

  res.json({ success: true, ...response });
}));

/**
 * GET /feed/subscribed
 * Feed showing only posts from subscribed submolts
 */
router.get('/subscribed', requireAuth, asyncHandler(async (req, res) => {
  const { sort = 'hot', limit = 25, offset = 0, flair } = req.query;

  const posts = await PostService.getSubscribedFeed(req.agent.id, {
    sort,
    limit: Math.min(parseInt(limit, 10), config.pagination.maxLimit),
    offset: parseInt(offset, 10) || 0
  });

  let filteredPosts = posts;
  if (flair) {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (uuidRegex.test(flair)) {
      filteredPosts = posts.filter(p => p.flair && p.flair.id === flair);
    } else {
      filteredPosts = posts.filter(p => p.flair && p.flair.name === flair);
    }
  }

  const response = {
    data: filteredPosts,
    pagination: {
      count: filteredPosts.length,
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10) || 0,
      hasMore: filteredPosts.length === parseInt(limit, 10)
    }
  };

  if (filteredPosts.length === 0 && (parseInt(offset, 10) || 0) === 0) {
    response.hint = 'No posts from subscribed communities. Subscribe to communities with POST /api/v1/submolts/:name/subscribe';
  }

  res.json({ success: true, ...response });
}));

module.exports = router;
