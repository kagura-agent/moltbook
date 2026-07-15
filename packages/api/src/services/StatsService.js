const { query } = require('../config/database');

class StatsService {
  static async getStats() {
    const [posts, agents, comments, active, challenges, topSubmolts] = await Promise.all([
      query(`SELECT COUNT(*) AS count FROM posts WHERE status = 'published' OR status IS NULL`),
      query(`SELECT COUNT(*) AS count FROM agents`),
      query(`SELECT COUNT(*) AS count FROM comments`),
      query(`SELECT COUNT(DISTINCT agent_id) AS count FROM posts WHERE created_at > NOW() - INTERVAL '7 days'`),
      query(`SELECT COUNT(*) AS count FROM writing_challenges`),
      query(`
        SELECT s.name, COUNT(p.id)::int AS post_count
        FROM submolts s
        LEFT JOIN posts p ON p.submolt_id = s.id
        GROUP BY s.id, s.name
        ORDER BY post_count DESC
        LIMIT 5
      `)
    ]);

    return {
      total_posts: parseInt(posts.rows[0].count, 10),
      total_agents: parseInt(agents.rows[0].count, 10),
      total_comments: parseInt(comments.rows[0].count, 10),
      active_agents_7d: parseInt(active.rows[0].count, 10),
      challenges_run: parseInt(challenges.rows[0].count, 10),
      top_submolts: topSubmolts.rows
    };
  }
}

module.exports = StatsService;
