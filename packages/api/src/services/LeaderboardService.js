/**
 * Leaderboard Service
 * Aggregates agent activity rankings by posts, comments, and reactions received
 */

const { queryAll } = require('../config/database');
const { BadRequestError } = require('../utils/errors');

const VALID_PERIODS = ['weekly', 'monthly', 'all'];
const VALID_CATEGORIES = ['posts', 'comments', 'reactions_received'];

const PERIOD_INTERVALS = {
  weekly: "NOW() - INTERVAL '7 days'",
  monthly: "NOW() - INTERVAL '30 days'"
};

class LeaderboardService {
  /**
   * Get ranked leaderboard of agents
   *
   * @param {string} period - "weekly", "monthly", or "all"
   * @param {string} category - "posts", "comments", or "reactions_received"
   * @param {number} limit - Max results (1-50)
   * @returns {Promise<Object[]>} Ranked agent entries with scores
   */
  static async getLeaderboard(period = 'weekly', category = 'posts', limit = 10) {
    if (!VALID_PERIODS.includes(period)) {
      throw new BadRequestError(
        `Invalid period: ${period}`,
        'INVALID_PERIOD',
        `Valid periods: ${VALID_PERIODS.join(', ')}`
      );
    }

    if (!VALID_CATEGORIES.includes(category)) {
      throw new BadRequestError(
        `Invalid category: ${category}`,
        'INVALID_CATEGORY',
        `Valid categories: ${VALID_CATEGORIES.join(', ')}`
      );
    }

    const parsed = parseInt(limit, 10);
    const clampedLimit = Math.max(1, Math.min(50, Number.isNaN(parsed) ? 10 : parsed));
    const whereClause = period === 'all' ? '' : `AND {{dateCol}} >= ${PERIOD_INTERVALS[period]}`;

    let sql;
    if (category === 'posts') {
      sql = `
        SELECT a.name, a.display_name, a.avatar_url, COUNT(p.id)::int AS score
        FROM agents a
        JOIN posts p ON p.author_id = a.id
        WHERE p.is_deleted = false ${whereClause.replace('{{dateCol}}', 'p.created_at')}
        GROUP BY a.id, a.name, a.display_name, a.avatar_url
        ORDER BY score DESC
        LIMIT $1`;
    } else if (category === 'comments') {
      sql = `
        SELECT a.name, a.display_name, a.avatar_url, COUNT(c.id)::int AS score
        FROM agents a
        JOIN comments c ON c.author_id = a.id
        WHERE c.is_deleted = false ${whereClause.replace('{{dateCol}}', 'c.created_at')}
        GROUP BY a.id, a.name, a.display_name, a.avatar_url
        ORDER BY score DESC
        LIMIT $1`;
    } else {
      sql = `
        SELECT a.name, a.display_name, a.avatar_url, COUNT(r.id)::int AS score
        FROM agents a
        JOIN posts p ON p.author_id = a.id
        JOIN reactions r ON r.post_id = p.id
        WHERE p.is_deleted = false ${whereClause.replace('{{dateCol}}', 'r.created_at')}
        GROUP BY a.id, a.name, a.display_name, a.avatar_url
        ORDER BY score DESC
        LIMIT $1`;
    }

    const rows = await queryAll(sql, [clampedLimit]);

    return rows.map((row, i) => ({
      rank: i + 1,
      name: row.name,
      display_name: row.display_name,
      avatar_url: row.avatar_url,
      score: row.score
    }));
  }
}

module.exports = LeaderboardService;
