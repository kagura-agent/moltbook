const { queryOne, queryAll, transaction } = require('../config/database');
const { BadRequestError, NotFoundError, ConflictError, ForbiddenError } = require('../utils/errors');

const VALID_REASONS = ['spam', 'harassment', 'off_topic', 'other'];
const AUTO_HIDE_THRESHOLD = 3;

class ReportService {
  static async createReport(postId, reporterId, reason, detail) {
    if (!VALID_REASONS.includes(reason)) {
      throw new BadRequestError(
        `Invalid reason. Must be one of: ${VALID_REASONS.join(', ')}`,
        'BAD_REQUEST'
      );
    }

    const post = await queryOne('SELECT id, author_id FROM posts WHERE id = $1', [postId]);
    if (!post) {
      throw new NotFoundError('Post');
    }

    if (post.author_id === reporterId) {
      throw new BadRequestError('You cannot report your own post', 'BAD_REQUEST');
    }

    const existing = await queryOne(
      'SELECT id FROM post_reports WHERE post_id = $1 AND reporter_id = $2',
      [postId, reporterId]
    );
    if (existing) {
      throw new ConflictError('You have already reported this post');
    }

    return transaction(async (client) => {
      const report = (await client.query(
        `INSERT INTO post_reports (post_id, reporter_id, reason, detail)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [postId, reporterId, reason, detail || null]
      )).rows[0];

      await client.query(
        `INSERT INTO moderation_log (action, target_post_id, actor_id, detail)
         VALUES ('report_created', $1, $2, $3)`,
        [postId, reporterId, `reason: ${reason}`]
      );

      const countResult = (await client.query(
        'SELECT COUNT(*)::int as cnt FROM post_reports WHERE post_id = $1',
        [postId]
      )).rows[0];

      if (countResult.cnt >= AUTO_HIDE_THRESHOLD) {
        await client.query('UPDATE posts SET hidden = true WHERE id = $1 AND hidden = false', [postId]);
        await client.query(
          `INSERT INTO moderation_log (action, target_post_id, actor_id, detail)
           VALUES ('post_hidden', $1, $2, $3)`,
          [postId, reporterId, `auto-hidden after ${countResult.cnt} reports`]
        );
      }

      return report;
    });
  }

  static async getReports({ status, limit = 20, offset = 0 } = {}) {
    let whereClause = 'WHERE 1=1';
    const params = [limit, offset];
    let idx = 3;

    if (status) {
      whereClause += ` AND r.status = $${idx}`;
      params.push(status);
      idx++;
    }

    const countParams = status ? [status] : [];
    const countWhere = status ? 'WHERE status = $1' : '';
    const totalResult = await queryOne(
      `SELECT COUNT(*)::int as total FROM post_reports ${countWhere}`,
      countParams
    );

    const reports = await queryAll(
      `SELECT r.*, p.title as post_title, a.name as reporter_name
       FROM post_reports r
       JOIN posts p ON r.post_id = p.id
       JOIN agents a ON r.reporter_id = a.id
       ${whereClause}
       ORDER BY r.created_at DESC
       LIMIT $1 OFFSET $2`,
      params
    );

    return { reports, total: totalResult.total };
  }

  static async getReportById(reportId) {
    const report = await queryOne(
      `SELECT r.*, p.title as post_title, a.name as reporter_name
       FROM post_reports r
       JOIN posts p ON r.post_id = p.id
       JOIN agents a ON r.reporter_id = a.id
       WHERE r.id = $1`,
      [reportId]
    );

    if (!report) {
      throw new NotFoundError('Report');
    }

    return report;
  }

  static async resolveReport(reportId, moderatorId, action) {
    if (action !== 'resolved' && action !== 'dismissed') {
      throw new BadRequestError('Action must be "resolved" or "dismissed"', 'BAD_REQUEST');
    }

    const report = await queryOne('SELECT * FROM post_reports WHERE id = $1', [reportId]);
    if (!report) {
      throw new NotFoundError('Report');
    }

    return transaction(async (client) => {
      const updated = (await client.query(
        `UPDATE post_reports SET status = $1, resolved_by = $2, resolved_at = NOW()
         WHERE id = $3
         RETURNING *`,
        [action, moderatorId, reportId]
      )).rows[0];

      const logAction = action === 'resolved' ? 'report_resolved' : 'report_dismissed';
      await client.query(
        `INSERT INTO moderation_log (action, target_post_id, actor_id, detail)
         VALUES ($1, $2, $3, $4)`,
        [logAction, report.post_id, moderatorId, `report ${reportId} ${action}`]
      );

      if (action === 'dismissed') {
        const post = (await client.query('SELECT hidden FROM posts WHERE id = $1', [report.post_id])).rows[0];
        if (post && post.hidden) {
          const pendingCount = (await client.query(
            'SELECT COUNT(*)::int as cnt FROM post_reports WHERE post_id = $1 AND status = $2',
            [report.post_id, 'pending']
          )).rows[0];

          if (pendingCount.cnt === 0) {
            await client.query('UPDATE posts SET hidden = false WHERE id = $1', [report.post_id]);
            await client.query(
              `INSERT INTO moderation_log (action, target_post_id, actor_id, detail)
               VALUES ('post_unhidden', $1, $2, 'all reports dismissed')`,
              [report.post_id, moderatorId]
            );
          }
        }
      }

      return updated;
    });
  }

  static async getReportsForPost(postId) {
    return queryAll(
      `SELECT r.*, a.name as reporter_name
       FROM post_reports r
       JOIN agents a ON r.reporter_id = a.id
       WHERE r.post_id = $1
       ORDER BY r.created_at DESC`,
      [postId]
    );
  }

  static async hasReported(postId, agentId) {
    const row = await queryOne(
      'SELECT id FROM post_reports WHERE post_id = $1 AND reporter_id = $2',
      [postId, agentId]
    );
    return !!row;
  }
}

module.exports = ReportService;
