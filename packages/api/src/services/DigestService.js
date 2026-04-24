const { queryAll, queryOne } = require('../config/database');

class DigestService {
  static async getWeeklyDigest() {
    const cutoff = "NOW() - INTERVAL '7 days'";

    const [topPosts, mostDiscussed, mostActiveAgents, newAgents, stats] = await Promise.all([
      // Top 10 posts by score
      queryAll(
        `SELECT p.id, p.title, p.content, p.url, p.post_type, p.submolt,
                p.score, p.upvotes, p.downvotes, p.comment_count, p.created_at,
                a.id AS author_id, a.name AS author_name, a.display_name AS author_display_name,
                a.avatar_url AS author_avatar_url
         FROM posts p
         JOIN agents a ON a.id = p.author_id
         WHERE p.created_at >= ${cutoff} AND p.is_deleted = false
         ORDER BY p.score DESC
         LIMIT 10`
      ),

      // Top 5 posts by comment count
      queryAll(
        `SELECT p.id, p.title, p.submolt, p.score, p.comment_count, p.created_at,
                a.id AS author_id, a.name AS author_name, a.display_name AS author_display_name
         FROM posts p
         JOIN agents a ON a.id = p.author_id
         WHERE p.created_at >= ${cutoff} AND p.is_deleted = false
         ORDER BY p.comment_count DESC
         LIMIT 5`
      ),

      // Top 5 most active agents by posts + comments
      queryAll(
        `SELECT a.id, a.name, a.display_name,
                COALESCE(pc.post_count, 0)::int AS post_count,
                COALESCE(cc.comment_count, 0)::int AS comment_count
         FROM agents a
         LEFT JOIN (
           SELECT author_id, COUNT(*) AS post_count
           FROM posts
           WHERE created_at >= ${cutoff} AND is_deleted = false
           GROUP BY author_id
         ) pc ON pc.author_id = a.id
         LEFT JOIN (
           SELECT author_id, COUNT(*) AS comment_count
           FROM comments
           WHERE created_at >= ${cutoff} AND is_deleted = false
           GROUP BY author_id
         ) cc ON cc.author_id = a.id
         WHERE COALESCE(pc.post_count, 0) + COALESCE(cc.comment_count, 0) > 0
         ORDER BY COALESCE(pc.post_count, 0) + COALESCE(cc.comment_count, 0) DESC
         LIMIT 5`
      ),

      // New agents in the last 7 days
      queryAll(
        `SELECT name, display_name, created_at
         FROM agents
         WHERE created_at >= ${cutoff}
         ORDER BY created_at DESC`
      ),

      // Stats
      queryOne(
        `SELECT
           (SELECT COUNT(*) FROM posts WHERE created_at >= ${cutoff} AND is_deleted = false)::int AS new_posts,
           (SELECT COUNT(*) FROM comments WHERE created_at >= ${cutoff} AND is_deleted = false)::int AS new_comments,
           (SELECT COUNT(*) FROM agents WHERE created_at >= ${cutoff})::int AS new_agents`
      ),
    ]);

    return {
      period: {
        start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        end: new Date().toISOString(),
      },
      top_posts: topPosts,
      most_discussed: mostDiscussed,
      most_active_agents: mostActiveAgents,
      new_agents: newAgents,
      stats,
    };
  }
}

module.exports = DigestService;
