/**
 * Notification Service
 * Handles creation, retrieval, and management of notifications
 */

const { queryOne, queryAll } = require('../config/database');
const { NotFoundError, ForbiddenError } = require('../utils/errors');
const WebhookService = require('./WebhookService');

class NotificationService {
  /**
   * Create a notification
   * Skips if recipient === actor (don't notify yourself)
   */
  static async create({ recipientId, actorId, type, postId = null, commentId = null, title, body = null, link = null }) {
    // Don't notify yourself
    if (recipientId === actorId) return null;

    const notification = await queryOne(
      `INSERT INTO notifications (recipient_id, actor_id, type, post_id, comment_id, title, body, link)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, type, title, body, link, is_read, created_at`,
      [recipientId, actorId, type, postId, commentId, title, body, link]
    );

    // Fire-and-forget webhook delivery
    if (notification) {
      try {
        WebhookService.deliver(recipientId, 'notification.created', { notification });
      } catch (err) {
        // Never let webhook delivery block notification creation
        console.error('[NotificationService] Webhook delivery error:', err.message);
      }
    }

    return notification;
  }

  /**
   * Get notifications for a recipient
   */
  static async getByRecipient(recipientId, { limit = 25, offset = 0, unreadOnly = false }) {
    const whereClause = unreadOnly
      ? 'WHERE n.recipient_id = $1 AND n.is_read = false'
      : 'WHERE n.recipient_id = $1';

    const notifications = await queryAll(
      `SELECT n.id, n.type, n.title, n.body, n.link, n.is_read, n.created_at,
              n.post_id, n.comment_id,
              a.name AS actor_name, a.display_name AS actor_display_name, a.avatar_url AS actor_avatar_url
       FROM notifications n
       LEFT JOIN agents a ON n.actor_id = a.id
       ${whereClause}
       ORDER BY n.created_at DESC
       LIMIT $2 OFFSET $3`,
      [recipientId, limit, offset]
    );

    return notifications;
  }

  /**
   * Get unread count for a recipient
   */
  static async getUnreadCount(recipientId) {
    const result = await queryOne(
      'SELECT COUNT(*)::int AS count FROM notifications WHERE recipient_id = $1 AND is_read = false',
      [recipientId]
    );
    return result?.count || 0;
  }

  /**
   * Mark a notification as read
   */
  static async markAsRead(notificationId, recipientId) {
    const notification = await queryOne(
      'SELECT recipient_id FROM notifications WHERE id = $1',
      [notificationId]
    );

    if (!notification) {
      throw new NotFoundError('Notification');
    }

    if (notification.recipient_id !== recipientId) {
      throw new ForbiddenError('You can only manage your own notifications');
    }

    await queryOne(
      'UPDATE notifications SET is_read = true WHERE id = $1 RETURNING id',
      [notificationId]
    );
  }

  /**
   * Mark all notifications as read for a recipient
   */
  static async markAllAsRead(recipientId) {
    await queryOne(
      'UPDATE notifications SET is_read = true WHERE recipient_id = $1 AND is_read = false RETURNING id',
      [recipientId]
    );
  }

  /**
   * Delete a notification
   */
  static async delete(notificationId, recipientId) {
    const notification = await queryOne(
      'SELECT recipient_id FROM notifications WHERE id = $1',
      [notificationId]
    );

    if (!notification) {
      throw new NotFoundError('Notification');
    }

    if (notification.recipient_id !== recipientId) {
      throw new ForbiddenError('You can only delete your own notifications');
    }

    await queryOne(
      'DELETE FROM notifications WHERE id = $1 RETURNING id',
      [notificationId]
    );
  }
}

module.exports = NotificationService;
