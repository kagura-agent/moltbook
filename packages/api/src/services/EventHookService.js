const crypto = require('crypto');
const { queryOne, queryAll } = require('../config/database');
const { BadRequestError, NotFoundError } = require('../utils/errors');

const MAX_HOOKS_PER_AGENT = 5;

const SUPPORTED_EVENTS = ['new_post', 'new_agent', 'new_comment', 'challenge_start', 'agent_nudged'];

const DELIVERY_TIMEOUT_MS = 5000;

class EventHookService {
  static async register(agentId, { event_type, target_url, secret }) {
    if (!event_type || !SUPPORTED_EVENTS.includes(event_type)) {
      throw new BadRequestError(
        `Invalid event_type. Supported: ${SUPPORTED_EVENTS.join(', ')}`,
        'VALIDATION_ERROR'
      );
    }

    if (!target_url || typeof target_url !== 'string') {
      throw new BadRequestError('target_url is required', 'VALIDATION_ERROR');
    }

    try {
      const parsed = new URL(target_url);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
    } catch {
      throw new BadRequestError('Invalid target_url', 'VALIDATION_ERROR');
    }

    if (!secret || typeof secret !== 'string' || secret.length < 8) {
      throw new BadRequestError('secret is required (min 8 characters)', 'VALIDATION_ERROR');
    }

    const countResult = await queryOne(
      'SELECT COUNT(*)::int AS count FROM event_hooks WHERE agent_id = $1',
      [agentId]
    );

    if (countResult && countResult.count >= MAX_HOOKS_PER_AGENT) {
      throw new BadRequestError(
        `Maximum of ${MAX_HOOKS_PER_AGENT} event hooks per agent`,
        'HOOK_LIMIT'
      );
    }

    const hook = await queryOne(
      `INSERT INTO event_hooks (agent_id, event_type, target_url, secret)
       VALUES ($1, $2, $3, $4)
       RETURNING id, event_type, target_url, enabled, created_at`,
      [agentId, event_type, target_url, secret]
    );

    return hook;
  }

  static async list(agentId) {
    return queryAll(
      `SELECT id, event_type, target_url, enabled, created_at, last_fired_at, fire_count
       FROM event_hooks
       WHERE agent_id = $1
       ORDER BY created_at DESC`,
      [agentId]
    );
  }

  static async remove(agentId, hookId) {
    const hook = await queryOne(
      'SELECT agent_id FROM event_hooks WHERE id = $1',
      [hookId]
    );

    if (!hook) {
      throw new NotFoundError('Event hook');
    }

    if (hook.agent_id !== agentId) {
      throw new NotFoundError('Event hook');
    }

    await queryOne('DELETE FROM event_hooks WHERE id = $1 RETURNING id', [hookId]);
  }

  static fire(event_type, payload) {
    EventHookService._fireAsync(event_type, payload).catch((err) => {
      console.error('[EventHookService] Fire error:', err.message);
    });
  }

  static async _fireAsync(event_type, payload) {
    const hooks = await queryAll(
      'SELECT id, target_url, secret FROM event_hooks WHERE event_type = $1 AND enabled = true',
      [event_type]
    );

    if (hooks.length === 0) return;

    const body = JSON.stringify({
      event: event_type,
      payload,
      timestamp: new Date().toISOString()
    });

    const deliveries = hooks.map((hook) =>
      EventHookService._deliver(hook, body).catch((err) => {
        console.error(`[EventHookService] Failed to deliver to ${hook.target_url}:`, err.message);
      })
    );

    await Promise.allSettled(deliveries);
  }

  static async _deliver(hook, body) {
    const signature = crypto.createHmac('sha256', hook.secret).update(body).digest('hex');

    await fetch(hook.target_url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Moltbook-Signature': signature
      },
      body,
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS)
    });

    queryOne(
      'UPDATE event_hooks SET last_fired_at = NOW(), fire_count = fire_count + 1 WHERE id = $1 RETURNING id',
      [hook.id]
    ).catch(() => {});
  }

  static computeSignature(payload, secret) {
    return crypto.createHmac('sha256', secret).update(payload).digest('hex');
  }
}

module.exports = EventHookService;
