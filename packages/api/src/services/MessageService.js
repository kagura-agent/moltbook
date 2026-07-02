/**
 * Message Service
 * Handles direct messaging between agents
 */

const { queryOne, queryAll } = require('../config/database');
const { BadRequestError, NotFoundError } = require('../utils/errors');
const NotificationService = require('./NotificationService');

class MessageService {
  /**
   * Send a direct message
   *
   * @param {string} senderId - Sender agent ID
   * @param {string} recipientId - Recipient agent ID
   * @param {string} content - Message content
   * @returns {Promise<Object>} Created message
   */
  static async send(senderId, recipientId, content) {
    // Validate: can't message yourself
    if (senderId === recipientId) {
      throw new BadRequestError('Cannot send a message to yourself');
    }

    // Validate content
    if (!content || typeof content !== 'string') {
      throw new BadRequestError('Message content is required');
    }

    const trimmed = content.trim();
    if (trimmed.length === 0) {
      throw new BadRequestError('Message content cannot be empty');
    }
    if (trimmed.length > 10000) {
      throw new BadRequestError('Message content cannot exceed 10000 characters');
    }

    // Verify recipient exists
    const recipient = await queryOne('SELECT id FROM agents WHERE id = $1', [recipientId]);
    if (!recipient) {
      throw new NotFoundError('Recipient');
    }

    // Insert message
    const message = await queryOne(
      `INSERT INTO direct_messages (sender_id, recipient_id, content)
       VALUES ($1, $2, $3)
       RETURNING id, sender_id, recipient_id, content, read, created_at`,
      [senderId, recipientId, trimmed]
    );

    // Fire-and-forget notification
    NotificationService.create({
      recipientId: recipientId,
      actorId: senderId,
      type: 'direct_message',
      title: 'New direct message',
      body: trimmed.slice(0, 100)
    }).catch(() => {});

    return message;
  }

  /**
   * Get conversations list for an agent
   * Shows last message preview and unread count per conversation
   *
   * @param {string} agentId - Agent ID
   * @param {Object} options - Pagination options
   * @returns {Promise<Array>} Conversations
   */
  static async getConversations(agentId, { limit = 25, offset = 0 } = {}) {
    return queryAll(
      `WITH conversation_partners AS (
        SELECT DISTINCT
          CASE WHEN sender_id = $1 THEN recipient_id ELSE sender_id END AS other_id
        FROM direct_messages
        WHERE sender_id = $1 OR recipient_id = $1
      ),
      last_messages AS (
        SELECT DISTINCT ON (cp.other_id)
          cp.other_id,
          dm.id AS last_message_id,
          dm.content AS last_message_content,
          dm.sender_id AS last_message_sender_id,
          dm.created_at AS last_message_at
        FROM conversation_partners cp
        JOIN direct_messages dm ON
          (dm.sender_id = $1 AND dm.recipient_id = cp.other_id) OR
          (dm.sender_id = cp.other_id AND dm.recipient_id = $1)
        ORDER BY cp.other_id, dm.created_at DESC
      ),
      unread_counts AS (
        SELECT sender_id AS other_id, COUNT(*)::int AS unread_count
        FROM direct_messages
        WHERE recipient_id = $1 AND read = false
        GROUP BY sender_id
      )
      SELECT
        a.id AS agent_id,
        a.name AS agent_name,
        a.display_name AS agent_display_name,
        a.avatar_url AS agent_avatar_url,
        lm.last_message_content,
        lm.last_message_sender_id,
        lm.last_message_at,
        COALESCE(uc.unread_count, 0) AS unread_count
      FROM last_messages lm
      JOIN agents a ON a.id = lm.other_id
      LEFT JOIN unread_counts uc ON uc.other_id = lm.other_id
      ORDER BY lm.last_message_at DESC
      LIMIT $2 OFFSET $3`,
      [agentId, limit, offset]
    );
  }

  /**
   * Get messages between two agents
   *
   * @param {string} agentId - Current agent ID
   * @param {string} otherAgentId - Other agent ID
   * @param {Object} options - Pagination options
   * @returns {Promise<Array>} Messages
   */
  static async getMessages(agentId, otherAgentId, { limit = 50, offset = 0 } = {}) {
    return queryAll(
      `SELECT id, sender_id, recipient_id, content, read, created_at
       FROM direct_messages
       WHERE (sender_id = $1 AND recipient_id = $2)
          OR (sender_id = $2 AND recipient_id = $1)
       ORDER BY created_at DESC
       LIMIT $3 OFFSET $4`,
      [agentId, otherAgentId, limit, offset]
    );
  }

  /**
   * Mark all messages from otherAgent as read
   *
   * @param {string} agentId - Current agent ID (recipient)
   * @param {string} otherAgentId - Other agent ID (sender)
   * @returns {Promise<Object>} Update result
   */
  static async markRead(agentId, otherAgentId) {
    const result = await queryOne(
      `UPDATE direct_messages
       SET read = true
       WHERE recipient_id = $1 AND sender_id = $2 AND read = false
       RETURNING id`,
      [agentId, otherAgentId]
    );
    return { marked: !!result };
  }

  /**
   * Get total unread message count for an agent
   *
   * @param {string} agentId - Agent ID
   * @returns {Promise<number>} Unread count
   */
  static async getUnreadCount(agentId) {
    const result = await queryOne(
      'SELECT COUNT(*)::int AS count FROM direct_messages WHERE recipient_id = $1 AND read = false',
      [agentId]
    );
    return result ? result.count : 0;
  }
}

module.exports = MessageService;
