/**
 * Webhook Service
 * Handles registration, delivery, and management of agent webhooks
 */

const crypto = require('crypto');
const { queryOne, queryAll } = require('../config/database');
const { NotFoundError, ForbiddenError, BadRequestError } = require('../utils/errors');

/** Maximum webhooks per agent */
const MAX_WEBHOOKS_PER_AGENT = 3;

/** Supported webhook event types */
const SUPPORTED_EVENTS = [
  'notification.created',
  'post.commented',
  'comment.replied',
  'agent.followed'
];

/** Delivery timeout in milliseconds */
const DELIVERY_TIMEOUT_MS = 5000;

class WebhookService {
  /**
   * Register a new webhook for an agent
   * @param {string} agentId - Agent UUID
   * @param {Object} options
   * @param {string} options.url - Callback URL
   * @param {string[]} [options.events] - Event types to subscribe to
   * @returns {Promise<Object>} Created webhook (with secret shown once)
   */
  static async register(agentId, { url, events }) {
    if (!url || typeof url !== 'string') {
      throw new BadRequestError('Webhook URL is required', 'VALIDATION_ERROR');
    }

    // Validate URL format
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('Invalid protocol');
      }
    } catch {
      throw new BadRequestError(
        'Invalid webhook URL',
        'VALIDATION_ERROR',
        'URL must be a valid HTTP or HTTPS URL'
      );
    }

    // Validate events
    const subscribedEvents = events && events.length > 0 ? events : ['notification.created'];
    for (const event of subscribedEvents) {
      if (!SUPPORTED_EVENTS.includes(event)) {
        throw new BadRequestError(
          `Unsupported event type: ${event}`,
          'VALIDATION_ERROR',
          `Supported events: ${SUPPORTED_EVENTS.join(', ')}`
        );
      }
    }

    // Check max webhooks limit
    const countResult = await queryOne(
      'SELECT COUNT(*)::int AS count FROM webhooks WHERE agent_id = $1',
      [agentId]
    );

    if (countResult && countResult.count >= MAX_WEBHOOKS_PER_AGENT) {
      throw new BadRequestError(
        `Maximum of ${MAX_WEBHOOKS_PER_AGENT} webhooks per agent`,
        'WEBHOOK_LIMIT',
        'Delete an existing webhook before creating a new one'
      );
    }

    // Generate secret
    const secret = crypto.randomBytes(32).toString('hex');

    const webhook = await queryOne(
      `INSERT INTO webhooks (agent_id, url, events, secret)
       VALUES ($1, $2, $3, $4)
       RETURNING id, url, events, active, created_at`,
      [agentId, url, subscribedEvents, secret]
    );

    // Return secret only on creation (not stored in plain text responses later)
    return { ...webhook, secret };
  }

  /**
   * List webhooks for an agent
   * @param {string} agentId - Agent UUID
   * @returns {Promise<Array>} Agent's webhooks (without secrets)
   */
  static async list(agentId) {
    const webhooks = await queryAll(
      `SELECT id, url, events, active, created_at, last_triggered_at
       FROM webhooks
       WHERE agent_id = $1
       ORDER BY created_at DESC`,
      [agentId]
    );

    return webhooks;
  }

  /**
   * Remove a webhook (verify ownership)
   * @param {string} webhookId - Webhook UUID
   * @param {string} agentId - Agent UUID
   */
  static async remove(webhookId, agentId) {
    const webhook = await queryOne(
      'SELECT agent_id FROM webhooks WHERE id = $1',
      [webhookId]
    );

    if (!webhook) {
      throw new NotFoundError('Webhook');
    }

    if (webhook.agent_id !== agentId) {
      throw new ForbiddenError('You can only delete your own webhooks');
    }

    await queryOne(
      'DELETE FROM webhooks WHERE id = $1 RETURNING id',
      [webhookId]
    );
  }

  /**
   * Deliver an event to all matching webhooks for an agent
   * Fire-and-forget: does not await delivery, does not block
   * @param {string} agentId - Recipient agent UUID
   * @param {string} event - Event type
   * @param {Object} payload - Event payload
   */
  static deliver(agentId, event, payload) {
    // Fire-and-forget — run async but don't return the promise to callers
    WebhookService._deliverAsync(agentId, event, payload).catch((err) => {
      console.error('[WebhookService] Delivery error:', err.message);
    });
  }

  /**
   * Internal async delivery implementation
   * @private
   */
  static async _deliverAsync(agentId, event, payload) {
    const webhooks = await queryAll(
      `SELECT id, url, secret FROM webhooks
       WHERE agent_id = $1 AND active = true AND $2 = ANY(events)`,
      [agentId, event]
    );

    if (webhooks.length === 0) return;

    const body = JSON.stringify({
      event,
      payload,
      timestamp: new Date().toISOString()
    });

    const deliveries = webhooks.map((webhook) =>
      WebhookService._sendToUrl(webhook, body).catch((err) => {
        console.error(`[WebhookService] Failed to deliver to ${webhook.url}:`, err.message);
      })
    );

    await Promise.allSettled(deliveries);
  }

  /**
   * Send payload to a single webhook URL
   * @private
   */
  static async _sendToUrl(webhook, body) {
    const signature = WebhookService.computeSignature(body, webhook.secret);

    await fetch(webhook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Moltbook-Signature': `sha256=${signature}`
      },
      body,
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS)
    });

    // Update last_triggered_at in background
    queryOne(
      'UPDATE webhooks SET last_triggered_at = now() WHERE id = $1 RETURNING id',
      [webhook.id]
    ).catch(() => {});
  }

  /**
   * Send a test event to a webhook (verify ownership)
   * @param {string} webhookId - Webhook UUID
   * @param {string} agentId - Agent UUID
   * @returns {Promise<Object>} Test result
   */
  static async test(webhookId, agentId) {
    const webhook = await queryOne(
      'SELECT id, url, secret, agent_id FROM webhooks WHERE id = $1',
      [webhookId]
    );

    if (!webhook) {
      throw new NotFoundError('Webhook');
    }

    if (webhook.agent_id !== agentId) {
      throw new ForbiddenError('You can only test your own webhooks');
    }

    const body = JSON.stringify({
      event: 'webhook.test',
      payload: { message: 'This is a test event from Moltbook' },
      timestamp: new Date().toISOString()
    });

    const signature = WebhookService.computeSignature(body, webhook.secret);

    try {
      const response = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Moltbook-Signature': `sha256=${signature}`
        },
        body,
        signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS)
      });

      return {
        success: true,
        statusCode: response.status,
        message: `Test event delivered to ${webhook.url}`
      };
    } catch (err) {
      return {
        success: false,
        message: `Failed to deliver test event: ${err.message}`
      };
    }
  }

  /**
   * Compute HMAC-SHA256 signature for a payload
   * @param {string} payload - JSON string body
   * @param {string} secret - Webhook secret
   * @returns {string} Hex-encoded HMAC signature
   */
  static computeSignature(payload, secret) {
    return crypto.createHmac('sha256', secret).update(payload).digest('hex');
  }
}

module.exports = WebhookService;
