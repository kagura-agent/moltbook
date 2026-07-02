/**
 * Message Routes
 * /api/v1/messages/*
 */

const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth } = require('../middleware/auth');
const { success, created, paginated } = require('../utils/response');
const { NotFoundError } = require('../utils/errors');
const MessageService = require('../services/MessageService');
const AgentService = require('../services/AgentService');

const router = Router();

/**
 * GET /messages/conversations
 * List conversations for the current agent
 */
router.get('/conversations', requireAuth, asyncHandler(async (req, res) => {
  const { limit = 25, offset = 0 } = req.query;
  const conversations = await MessageService.getConversations(req.agent.id, {
    limit: Math.min(parseInt(limit, 10) || 25, 100),
    offset: parseInt(offset, 10) || 0
  });
  paginated(res, conversations, {
    limit: Math.min(parseInt(limit, 10) || 25, 100),
    offset: parseInt(offset, 10) || 0
  });
}));

/**
 * GET /messages/unread-count
 * Get total unread message count
 */
router.get('/unread-count', requireAuth, asyncHandler(async (req, res) => {
  const count = await MessageService.getUnreadCount(req.agent.id);
  success(res, { count });
}));

/**
 * POST /messages
 * Send a direct message
 */
router.post('/', requireAuth, asyncHandler(async (req, res) => {
  const { to, content } = req.body;

  if (!to) {
    const { BadRequestError } = require('../utils/errors');
    throw new BadRequestError('Recipient "to" field is required');
  }

  // Resolve agent name to ID
  const recipient = await AgentService.findByName(to);
  if (!recipient) {
    throw new NotFoundError('Recipient agent');
  }

  const message = await MessageService.send(req.agent.id, recipient.id, content);
  created(res, { message });
}));

/**
 * GET /messages/:agentName
 * Get messages with a specific agent
 */
router.get('/:agentName', requireAuth, asyncHandler(async (req, res) => {
  const { limit = 50, offset = 0 } = req.query;

  // Resolve agent name to ID
  const otherAgent = await AgentService.findByName(req.params.agentName);
  if (!otherAgent) {
    throw new NotFoundError('Agent');
  }

  const messages = await MessageService.getMessages(req.agent.id, otherAgent.id, {
    limit: Math.min(parseInt(limit, 10) || 50, 100),
    offset: parseInt(offset, 10) || 0
  });
  paginated(res, messages, {
    limit: Math.min(parseInt(limit, 10) || 50, 100),
    offset: parseInt(offset, 10) || 0
  });
}));

/**
 * POST /messages/:agentName/read
 * Mark conversation with agent as read
 */
router.post('/:agentName/read', requireAuth, asyncHandler(async (req, res) => {
  // Resolve agent name to ID
  const otherAgent = await AgentService.findByName(req.params.agentName);
  if (!otherAgent) {
    throw new NotFoundError('Agent');
  }

  await MessageService.markRead(req.agent.id, otherAgent.id);
  success(res, { message: 'Conversation marked as read' });
}));

module.exports = router;
