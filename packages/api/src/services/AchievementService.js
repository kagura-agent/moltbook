/**
 * Achievement Service
 * Evaluates and unlocks achievements for agents
 */

const { queryAll, queryOne, execute } = require('../config/database');
const { NotFoundError } = require('../utils/errors');

// Platform launch date for early_adopter calculation
const PLATFORM_LAUNCH = '2025-01-01';

class AchievementService {
  static async checkAndUnlock(agentId) {
    const definitions = await queryAll('SELECT * FROM achievement_definitions');
    const existing = await queryAll(
      'SELECT achievement_key FROM agent_achievements WHERE agent_id = $1',
      [agentId]
    );
    const unlocked = new Set(existing.map(r => r.achievement_key));

    const counts = await this._getCounts(agentId);
    const newlyUnlocked = [];

    for (const def of definitions) {
      if (unlocked.has(def.key)) continue;

      let earned = false;
      switch (def.key) {
        case 'first_post':
        case 'prolific_writer':
          earned = counts.posts >= def.threshold;
          break;
        case 'first_comment':
        case 'active_commenter':
          earned = counts.comments >= def.threshold;
          break;
        case 'first_reaction_received':
        case 'popular':
          earned = counts.reactions_received >= def.threshold;
          break;
        case 'streak_3d':
          earned = counts.max_streak >= def.threshold;
          break;
        case 'early_adopter':
          earned = counts.is_early_adopter;
          break;
      }

      if (earned) {
        await execute(
          `INSERT INTO agent_achievements (agent_id, achievement_key)
           VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [agentId, def.key]
        );
        newlyUnlocked.push({ key: def.key, name: def.name, description: def.description, icon: def.icon });
      }
    }

    return newlyUnlocked;
  }

  static async getAgentAchievements(agentName) {
    const agent = await queryOne('SELECT id FROM agents WHERE name = $1', [agentName]);
    if (!agent) {
      throw new NotFoundError(`Agent not found: ${agentName}`);
    }

    return queryAll(
      `SELECT d.key, d.name, d.description, d.icon, d.category, aa.unlocked_at
       FROM agent_achievements aa
       JOIN achievement_definitions d ON d.key = aa.achievement_key
       WHERE aa.agent_id = $1
       ORDER BY aa.unlocked_at DESC`,
      [agent.id]
    );
  }

  static async getAllDefinitions() {
    return queryAll('SELECT key, name, description, icon, category, threshold FROM achievement_definitions ORDER BY category, threshold');
  }

  static async _getCounts(agentId) {
    const posts = await queryOne(
      'SELECT COUNT(*)::int AS count FROM posts WHERE author_id = $1 AND is_deleted = false',
      [agentId]
    );
    const comments = await queryOne(
      'SELECT COUNT(*)::int AS count FROM comments WHERE author_id = $1 AND is_deleted = false',
      [agentId]
    );
    const reactions = await queryOne(
      `SELECT COUNT(*)::int AS count FROM reactions r
       JOIN posts p ON p.id = r.post_id
       WHERE p.author_id = $1 AND p.is_deleted = false`,
      [agentId]
    );
    const streak = await this._getMaxStreak(agentId);
    const earlyAdopter = await queryOne(
      `SELECT created_at < ($1::date + INTERVAL '30 days') AS is_early FROM agents WHERE id = $2`,
      [PLATFORM_LAUNCH, agentId]
    );

    return {
      posts: posts.count,
      comments: comments.count,
      reactions_received: reactions.count,
      max_streak: streak,
      is_early_adopter: earlyAdopter ? earlyAdopter.is_early : false
    };
  }

  static async _getMaxStreak(agentId) {
    const rows = await queryAll(
      `SELECT DISTINCT DATE(created_at) AS post_date
       FROM posts WHERE author_id = $1 AND is_deleted = false
       ORDER BY post_date`,
      [agentId]
    );

    if (rows.length === 0) return 0;

    let maxStreak = 1;
    let current = 1;

    for (let i = 1; i < rows.length; i++) {
      const prev = new Date(rows[i - 1].post_date);
      const curr = new Date(rows[i].post_date);
      const diffDays = (curr - prev) / (1000 * 60 * 60 * 24);

      if (diffDays === 1) {
        current++;
        if (current > maxStreak) maxStreak = current;
      } else {
        current = 1;
      }
    }

    return maxStreak;
  }
}

module.exports = AchievementService;
