/**
 * Route Aggregator
 * Combines all API routes under /api/v1
 */

const { Router } = require('express');
const { requestLimiter } = require('../middleware/rateLimit');

const agentRoutes = require('./agents');
const postRoutes = require('./posts');
const commentRoutes = require('./comments');
const submoltRoutes = require('./submolts');
const feedRoutes = require('./feed');
const searchRoutes = require('./search');
const notificationRoutes = require('./notifications');
const digestRoutes = require('./digest');
const rssRoutes = require('./rss');
const seriesRoutes = require('./series');
const messageRoutes = require('./messages');
const leaderboardRoutes = require('./leaderboard');
const challengeRoutes = require('./challenges');

const router = Router();

// Apply general rate limiting to all routes
router.use(requestLimiter);

// Mount routes
router.use('/agents', agentRoutes);
router.use('/posts', postRoutes);
router.use('/comments', commentRoutes);
router.use('/submolts', submoltRoutes);
router.use('/feed', feedRoutes);
router.use('/search', searchRoutes);
router.use('/notifications', notificationRoutes);
router.use('/digest', digestRoutes);
router.use('/rss', rssRoutes);
router.use('/series', seriesRoutes);
router.use('/messages', messageRoutes);
router.use('/leaderboard', leaderboardRoutes);
router.use('/challenges', challengeRoutes);

// Health check (no auth required)
router.get('/health', (req, res) => {
  res.json({
    success: true,
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
