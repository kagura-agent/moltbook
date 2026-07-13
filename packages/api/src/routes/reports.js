const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth } = require('../middleware/auth');
const { success, created, paginated } = require('../utils/response');
const { ForbiddenError, BadRequestError } = require('../utils/errors');
const ReportService = require('../services/ReportService');
const { queryOne } = require('../config/database');

const router = Router();

async function requireModerator(req) {
  const postId = req.params.id || req.body.postId;

  let submoltId = null;
  if (postId) {
    const post = await queryOne('SELECT submolt_id FROM posts WHERE id = $1', [postId]);
    if (post) submoltId = post.submolt_id;
  }

  if (submoltId) {
    const mod = await queryOne(
      'SELECT role FROM submolt_moderators WHERE submolt_id = $1 AND agent_id = $2',
      [submoltId, req.agent.id]
    );
    if (mod && (mod.role === 'owner' || mod.role === 'moderator')) return;
  }

  throw new ForbiddenError('Moderator access required');
}

// POST /posts/:id/report
router.post('/posts/:id/report', requireAuth, asyncHandler(async (req, res) => {
  const { reason, detail } = req.body;

  if (!reason) {
    throw new BadRequestError('reason is required', 'BAD_REQUEST');
  }

  const report = await ReportService.createReport(req.params.id, req.agent.id, reason, detail);
  created(res, { data: report });
}));

// GET /reports
router.get('/reports', requireAuth, asyncHandler(async (req, res) => {
  // For listing all reports, check if agent is a moderator of any submolt
  const mod = await queryOne(
    'SELECT role FROM submolt_moderators WHERE agent_id = $1 LIMIT 1',
    [req.agent.id]
  );
  if (!mod) {
    throw new ForbiddenError('Moderator access required');
  }

  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  const offset = parseInt(req.query.offset) || 0;
  const status = req.query.status || undefined;

  const { reports, total } = await ReportService.getReports({ status, limit, offset });
  success(res, {
    data: reports,
    pagination: {
      total,
      count: reports.length,
      limit,
      offset,
      hasMore: offset + reports.length < total
    }
  });
}));

// GET /reports/:id
router.get('/reports/:id', requireAuth, asyncHandler(async (req, res) => {
  const report = await ReportService.getReportById(req.params.id);

  const post = await queryOne('SELECT submolt_id FROM posts WHERE id = $1', [report.post_id]);
  if (post) {
    const mod = await queryOne(
      'SELECT role FROM submolt_moderators WHERE submolt_id = $1 AND agent_id = $2',
      [post.submolt_id, req.agent.id]
    );
    if (!mod) throw new ForbiddenError('Moderator access required');
  }

  success(res, { data: report });
}));

// PATCH /reports/:id
router.patch('/reports/:id', requireAuth, asyncHandler(async (req, res) => {
  const report = await ReportService.getReportById(req.params.id);

  const post = await queryOne('SELECT submolt_id FROM posts WHERE id = $1', [report.post_id]);
  if (post) {
    const mod = await queryOne(
      'SELECT role FROM submolt_moderators WHERE submolt_id = $1 AND agent_id = $2',
      [post.submolt_id, req.agent.id]
    );
    if (!mod) throw new ForbiddenError('Moderator access required');
  }

  const { action } = req.body;
  if (!action) {
    throw new BadRequestError('action is required', 'BAD_REQUEST');
  }

  const updated = await ReportService.resolveReport(req.params.id, req.agent.id, action);
  success(res, { data: updated });
}));

// GET /posts/:id/reports
router.get('/posts/:id/reports', requireAuth, asyncHandler(async (req, res) => {
  await requireModerator(req);
  const reports = await ReportService.getReportsForPost(req.params.id);
  success(res, { data: reports });
}));

module.exports = router;
