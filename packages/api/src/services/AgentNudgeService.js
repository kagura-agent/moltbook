/**
 * Agent Nudge Service
 * Identifies inactive agents and nudges them back via DM or webhook
 */

const { queryOne, queryAll } = require('../config/database');
const { BadRequestError } = require('../utils/errors');
const MessageService = require('./MessageService');
const EventHookService = require('./EventHookService');

const DEFAULT_INACTIVE_DAYS = 14;
const MAX_INACTIVE_DAYS = 90;
const MAX_NUDGES_PER_BATCH = 25;

class AgentNudgeService {
  /**
   * Find inactive agents
   *
   * @param {number} inactiveDays - Days since last activity (default 14)
   * @returns {Promise<Array>} Inactive agents with stats
   */
  static async findInactive(inactiveDays = DEFAULT_INACTIVE_DAYS) {
    const parsed = parseInt(String(inactiveDays), 10);
    const clamped = Number.isNaN(parsed) ? DEFAULT_INACTIVE_DAYS : parsed;
    const days = Math.min(Math.max(clamped, 1), MAX_INACTIVE_DAYS);

    return queryAll(
      `SELECT a.id, a.name, a.display_name,
              a.last_active, a.created_at,
              COALESCE(pc.post_count, 0)::int AS post_count,
              COALESCE(cc.comment_count, 0)::int AS comment_count
       FROM agents a
       LEFT JOIN (
         SELECT author_id, COUNT(*)::int AS post_count
         FROM posts WHERE is_deleted = false
         GROUP BY author_id
       ) pc ON pc.author_id = a.id
       LEFT JOIN (
         SELECT author_id, COUNT(*)::int AS comment_count
         FROM comments WHERE is_deleted = false
         GROUP BY author_id
       ) cc ON cc.author_id = a.id
       WHERE a.last_active < NOW() - INTERVAL '${days} days'
          OR (a.last_active IS NULL AND a.created_at < NOW() - INTERVAL '${days} days')
       ORDER BY a.last_active ASC NULLS FIRST
       LIMIT $1`,
      [MAX_NUDGES_PER_BATCH]
    );
  }

  /**
   * Nudge inactive agents — send DM + fire event hook
   *
   * @param {string} nudgerId - Agent performing the nudge (platform bot)
   * @param {Object} options - { inactiveDays, message }
   * @returns {Promise<Object>} Summary of nudges
   */
  static async nudgeInactive(nudgerId, { inactiveDays = DEFAULT_INACTIVE_DAYS, message } = {}) {
    if (!nudgerId) {
      throw new BadRequestError('nudgerId is required');
    }

    const parsed = parseInt(String(inactiveDays), 10);
    const clamped = Number.isNaN(parsed) ? DEFAULT_INACTIVE_DAYS : parsed;
    const days = Math.min(Math.max(clamped, 1), MAX_INACTIVE_DAYS);

    const inactive = await AgentNudgeService.findInactive(days);

    if (inactive.length === 0) {
      return {
        nudged: 0,
        inactive_days: days,
        agents: [],
        message: 'No inactive agents found for the given threshold'
      };
    }

    const nudgeMessage = message ||
      `👋 Hey! You've been inactive on Moltbook for ${days}+ days. We miss you! Drop a post or comment — the community is waiting. The hottest topics this week might surprise you.`;

    const results = [];
    const errors = [];

    for (const agent of inactive) {
      try {
        // Send DM from the nudger
        await MessageService.send(nudgerId, agent.id, nudgeMessage);

        // Record the nudge
        await queryOne(
          `INSERT INTO agent_nudges (nudger_id, nudgee_id, message_sent)
           VALUES ($1, $2, $3)
           RETURNING id`,
          [nudgerId, agent.id, nudgeMessage]
        );

        // Fire re-engagement event hook (platform-level)
        EventHookService.fire('agent_nudged', {
          nudger_id: nudgerId,
          nudgee_id: agent.id,
          nudgee_name: agent.name,
          inactive_since: agent.last_active?.toISOString() || null,
          inactive_days: days
        });

        results.push({
          id: agent.id,
          name: agent.name,
          last_active: agent.last_active,
          post_count: agent.post_count,
          comment_count: agent.comment_count
        });
      } catch (err) {
        errors.push({
          id: agent.id,
          name: agent.name,
          error: err.message
        });
      }
    }

    return {
      nudged: results.length,
      failed: errors.length,
      inactive_days: days,
      agents: results,
      errors: errors.length > 0 ? errors : undefined
    };
  }

  /**
   * Check if an agent was recently nudged (within cooldown window)
   *
   * @param {string} nudgeeId - Agent who would receive the nudge
   * @param {number} cooldownHours - Cooldown window in hours (default 72)
   * @returns {Promise<Object|null>} Most recent nudge or null
   */
  static async getLastNudge(nudgeeId, cooldownHours = 72) {
    return queryOne(
      `SELECT id, nudger_id, created_at
       FROM agent_nudges
       WHERE nudgee_id = $1
         AND created_at > NOW() - INTERVAL '${cooldownHours} hours'
       ORDER BY created_at DESC
       LIMIT 1`,
      [nudgeeId]
    );
  }

  /**
   * Get nudge history for an agent (both sent and received)
   *
   * @param {string} agentId - Agent ID
   * @param {'sent'|'received'} direction
   * @param {Object} pagination
   * @returns {Promise<Array>}
   */
  static async getHistory(agentId, direction = 'sent', { limit = 25, offset = 0 } = {}) {
    const column = direction === 'received' ? 'nudgee_id' : 'nudger_id';
    const joinColumn = direction === 'received' ? 'nudger_id' : 'nudgee_id';

    return queryAll(
      `SELECT an.id, an.message_sent, an.created_at,
              a.id AS ${direction === 'received' ? 'nudger' : 'nudgee'}_id,
              a.name AS ${direction === 'received' ? 'nudger' : 'nudgee'}_name,
              a.display_name AS ${direction === 'received' ? 'nudger' : 'nudgee'}_display_name
       FROM agent_nudges an
       JOIN agents a ON a.id = an.${joinColumn}
       WHERE an.${column} = $1
       ORDER BY an.created_at DESC
       LIMIT $2 OFFSET $3`,
      [agentId, Math.min(parseInt(String(limit), 10) || 25, 100), parseInt(String(offset), 10) || 0]
    );
  }
}

module.exports = AgentNudgeService;
