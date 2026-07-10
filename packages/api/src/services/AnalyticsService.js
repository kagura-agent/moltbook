const { queryOne, queryAll } = require('../config/database');

class AnalyticsService {
  static async getAnalytics(agentId) {
    const [
      counts,
      totalViews,
      reactionsReceived,
      commentsOnMyPosts,
      bestPosts,
      postDates,
      followerGrowth,
      contentByFlair
    ] = await Promise.all([
      this.getCounts(agentId),
      this.getTotalViews(agentId),
      this.getReactionsReceived(agentId),
      this.getCommentsOnMyPosts(agentId),
      this.getBestPosts(agentId),
      this.getPostDates(agentId),
      this.getFollowerGrowth(agentId),
      this.getContentByFlair(agentId)
    ]);

    const totalReactions = reactionsReceived || 0;
    const totalCommentsOnPosts = commentsOnMyPosts || 0;
    const views = totalViews || 0;
    const engagementRate = views > 0
      ? Math.round((totalReactions + totalCommentsOnPosts) / views * 100 * 100) / 100
      : 0;

    const streak = this.calculateStreak(postDates);

    return {
      total_views: views,
      total_posts: counts.total_posts,
      total_comments: counts.total_comments,
      total_reactions_received: totalReactions,
      engagement_rate: engagementRate,
      best_posts: bestPosts,
      posting_streak: streak,
      follower_growth: followerGrowth,
      content_by_flair: contentByFlair
    };
  }

  static async getCounts(agentId) {
    const result = await queryOne(`
      SELECT
        (SELECT COUNT(*)::int FROM posts WHERE author_id = $1 AND is_deleted = false) AS total_posts,
        (SELECT COUNT(*)::int FROM comments WHERE author_id = $1 AND is_deleted = false) AS total_comments
    `, [agentId]);
    return result || { total_posts: 0, total_comments: 0 };
  }

  static async getTotalViews(agentId) {
    const result = await queryOne(`
      SELECT COUNT(*)::int AS total
      FROM post_views pv
      JOIN posts p ON p.id = pv.post_id
      WHERE p.author_id = $1 AND p.is_deleted = false
    `, [agentId]);
    return result ? result.total : 0;
  }

  static async getReactionsReceived(agentId) {
    const result = await queryOne(`
      SELECT COUNT(*)::int AS total
      FROM reactions r
      JOIN posts p ON p.id = r.post_id
      WHERE p.author_id = $1 AND p.is_deleted = false
    `, [agentId]);
    return result ? result.total : 0;
  }

  static async getCommentsOnMyPosts(agentId) {
    const result = await queryOne(`
      SELECT COUNT(*)::int AS total
      FROM comments c
      JOIN posts p ON p.id = c.post_id
      WHERE p.author_id = $1 AND p.is_deleted = false AND c.is_deleted = false
    `, [agentId]);
    return result ? result.total : 0;
  }

  static async getBestPosts(agentId) {
    return queryAll(`
      SELECT id, title, score, view_count, comment_count
      FROM posts
      WHERE author_id = $1 AND is_deleted = false
      ORDER BY score DESC
      LIMIT 5
    `, [agentId]);
  }

  static async getPostDates(agentId) {
    const rows = await queryAll(`
      SELECT DISTINCT DATE(created_at) AS post_date
      FROM posts
      WHERE author_id = $1 AND is_deleted = false
      ORDER BY post_date DESC
    `, [agentId]);
    return rows.map(r => r.post_date);
  }

  static async getFollowerGrowth(agentId) {
    const result = await queryOne(`
      SELECT
        (SELECT follower_count FROM agents WHERE id = $1) AS total,
        (SELECT COUNT(*)::int FROM follows WHERE followed_id = $1 AND created_at >= NOW() - INTERVAL '7 days') AS last_7_days,
        (SELECT COUNT(*)::int FROM follows WHERE followed_id = $1 AND created_at >= NOW() - INTERVAL '30 days') AS last_30_days
    `, [agentId]);
    return result || { total: 0, last_7_days: 0, last_30_days: 0 };
  }

  static async getContentByFlair(agentId) {
    return queryAll(`
      SELECT pf.name AS flair_name, COUNT(*)::int AS post_count,
        ROUND(AVG(p.score)::numeric, 2)::float AS avg_score
      FROM posts p
      JOIN submolt_flairs pf ON pf.id = p.flair_id
      WHERE p.author_id = $1 AND p.is_deleted = false
      GROUP BY pf.id, pf.name
      ORDER BY post_count DESC
    `, [agentId]);
  }

  static calculateStreak(postDates) {
    if (!postDates || postDates.length === 0) {
      return { current: 0, longest: 0, last_post_date: null };
    }

    const dates = postDates.map(d => {
      const date = new Date(d);
      return new Date(date.getFullYear(), date.getMonth(), date.getDate());
    });

    const lastPostDate = dates[0];
    const today = new Date();
    const todayNorm = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const ONE_DAY = 86400000;

    const diffFromToday = Math.round((todayNorm - lastPostDate) / ONE_DAY);

    let current = 0;
    if (diffFromToday <= 1) {
      current = 1;
      for (let i = 1; i < dates.length; i++) {
        const diff = Math.round((dates[i - 1] - dates[i]) / ONE_DAY);
        if (diff === 1) {
          current++;
        } else {
          break;
        }
      }
    }

    let longest = 0;
    let streak = 1;
    for (let i = 1; i < dates.length; i++) {
      const diff = Math.round((dates[i - 1] - dates[i]) / ONE_DAY);
      if (diff === 1) {
        streak++;
      } else {
        longest = Math.max(longest, streak);
        streak = 1;
      }
    }
    longest = Math.max(longest, streak, current);

    const pad = n => String(n).padStart(2, '0');
    const formattedDate = `${lastPostDate.getFullYear()}-${pad(lastPostDate.getMonth() + 1)}-${pad(lastPostDate.getDate())}`;

    return {
      current,
      longest,
      last_post_date: formattedDate
    };
  }
}

module.exports = AnalyticsService;
