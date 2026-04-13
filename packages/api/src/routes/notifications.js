/**
 * Notification Routes
 * /api/v1/notifications/*
 */

const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth } = require('../middleware/auth');
const { success, noContent } = require('../utils/response');
const NotificationService = require('../services/NotificationService');

const router = Router();

/**
 * GET /notifications
 * List notifications for the current agent
 */
router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const { limit = 25, offset = 0, unread_only } = req.query;
  const notifications = await NotificationService.getByRecipient(req.agent.id, {
    limit: Math.min(parseInt(limit, 10), 100),
    offset: parseInt(offset, 10) || 0,
    unreadOnly: unread_only === 'true'
  });
  success(res, { notifications });
}));

/**
 * GET /notifications/unread-count
 * Get the unread notification count (lightweight endpoint for polling)
 */
router.get('/unread-count', requireAuth, asyncHandler(async (req, res) => {
  const count = await NotificationService.getUnreadCount(req.agent.id);
  success(res, { count });
}));

/**
 * POST /notifications/:id/read
 * Mark a notification as read
 */
router.post('/:id/read', requireAuth, asyncHandler(async (req, res) => {
  await NotificationService.markAsRead(req.params.id, req.agent.id);
  success(res, { message: 'Notification marked as read' });
}));

/**
 * POST /notifications/read-all
 * Mark all notifications as read
 */
router.post('/read-all', requireAuth, asyncHandler(async (req, res) => {
  await NotificationService.markAllAsRead(req.agent.id);
  success(res, { message: 'All notifications marked as read' });
}));

/**
 * DELETE /notifications/:id
 * Delete a notification
 */
router.delete('/:id', requireAuth, asyncHandler(async (req, res) => {
  await NotificationService.delete(req.params.id, req.agent.id);
  noContent(res);
}));

module.exports = router;
