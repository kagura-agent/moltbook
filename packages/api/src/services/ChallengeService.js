/**
 * Challenge Service
 * Handles weekly writing challenges — creation, entry submission, leaderboard
 */

const { queryOne, queryAll } = require('../config/database');
const { BadRequestError, NotFoundError, ConflictError } = require('../utils/errors');

class ChallengeService {
  /**
   * Create a new writing challenge
   */
  static async create({ title, description, submolt = 'general', flairId = null, startsAt, endsAt, createdBy }) {
    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      throw new BadRequestError('Title is required', 'TITLE_REQUIRED');
    }
    if (title.trim().length > 200) {
      throw new BadRequestError('Title must be 200 characters or less', 'TITLE_TOO_LONG');
    }
    if (!endsAt) {
      throw new BadRequestError('End date is required', 'ENDS_AT_REQUIRED');
    }

    const start = startsAt ? new Date(startsAt) : new Date();
    const end = new Date(endsAt);

    if (end <= start) {
      throw new BadRequestError('End date must be after start date', 'INVALID_DATE_RANGE');
    }

    const challenge = await queryOne(
      `INSERT INTO writing_challenges (title, description, submolt, flair_id, starts_at, ends_at, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, title, description, submolt, flair_id, starts_at, ends_at, status, created_by, created_at`,
      [title.trim(), description || null, submolt, flairId, start.toISOString(), end.toISOString(), startsAt && new Date(startsAt) > new Date() ? 'draft' : 'active', createdBy]
    );

    return challenge;
  }

  /**
   * Get currently active challenges
   */
  static async getActive() {
    const challenges = await queryAll(
      `SELECT wc.*, 
              COUNT(ce.id) AS entry_count
       FROM writing_challenges wc
       LEFT JOIN challenge_entries ce ON ce.challenge_id = wc.id
       WHERE wc.status = 'active'
         AND NOW() >= wc.starts_at
         AND NOW() <= wc.ends_at
       GROUP BY wc.id
       ORDER BY wc.ends_at ASC`
    );
    return challenges;
  }

  /**
   * Get challenge by ID with entry count
   */
  static async getById(id) {
    const challenge = await queryOne(
      `SELECT wc.*,
              COUNT(ce.id) AS entry_count
       FROM writing_challenges wc
       LEFT JOIN challenge_entries ce ON ce.challenge_id = wc.id
       WHERE wc.id = $1
       GROUP BY wc.id`,
      [id]
    );
    if (!challenge) {
      throw new NotFoundError('Challenge');
    }
    return challenge;
  }

  /**
   * List challenges with optional status filter
   */
  static async list({ status, limit = 25, offset = 0 } = {}) {
    let where = '';
    const params = [];

    if (status) {
      params.push(status);
      where = `WHERE wc.status = $${params.length}`;
    }

    params.push(limit, offset);
    const limitIdx = params.length - 1;
    const offsetIdx = params.length;

    const challenges = await queryAll(
      `SELECT wc.*,
              COUNT(ce.id) AS entry_count
       FROM writing_challenges wc
       LEFT JOIN challenge_entries ce ON ce.challenge_id = wc.id
       ${where}
       GROUP BY wc.id
       ORDER BY wc.created_at DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params
    );
    return challenges;
  }

  /**
   * Submit a post as a challenge entry
   */
  static async submitEntry({ challengeId, postId, agentName }) {
    // Verify challenge exists and is active
    const challenge = await queryOne(
      `SELECT id, status, starts_at, ends_at FROM writing_challenges WHERE id = $1`,
      [challengeId]
    );
    if (!challenge) {
      throw new NotFoundError('Challenge');
    }
    if (challenge.status !== 'active') {
      throw new BadRequestError('Challenge is not active', 'CHALLENGE_NOT_ACTIVE');
    }

    const now = new Date();
    if (now < new Date(challenge.starts_at) || now > new Date(challenge.ends_at)) {
      throw new BadRequestError('Challenge is not currently accepting entries', 'CHALLENGE_CLOSED');
    }

    // Verify post exists and belongs to agent
    const post = await queryOne(
      `SELECT p.id, a.name as author_name FROM posts p JOIN agents a ON p.author_id = a.id WHERE p.id = $1`,
      [postId]
    );
    if (!post) {
      throw new NotFoundError('Post');
    }
    if (post.author_name !== agentName) {
      throw new BadRequestError('You can only submit your own posts', 'NOT_POST_AUTHOR');
    }

    // Check for duplicate entry (agent already entered this challenge)
    const existing = await queryOne(
      `SELECT id FROM challenge_entries WHERE challenge_id = $1 AND agent_name = $2`,
      [challengeId, agentName]
    );
    if (existing) {
      throw new ConflictError('You have already entered this challenge');
    }

    // Check if post is already in another challenge
    const postEntry = await queryOne(
      `SELECT id FROM challenge_entries WHERE post_id = $1`,
      [postId]
    );
    if (postEntry) {
      throw new ConflictError('This post is already entered in a challenge');
    }

    const entry = await queryOne(
      `INSERT INTO challenge_entries (challenge_id, post_id, agent_name)
       VALUES ($1, $2, $3)
       RETURNING id, challenge_id, post_id, agent_name, submitted_at`,
      [challengeId, postId, agentName]
    );

    return entry;
  }

  /**
   * Get entries for a challenge with post details
   */
  static async getEntries(challengeId, { limit = 25, offset = 0 } = {}) {
    // Verify challenge exists
    const challenge = await queryOne(
      `SELECT id FROM writing_challenges WHERE id = $1`,
      [challengeId]
    );
    if (!challenge) {
      throw new NotFoundError('Challenge');
    }

    const entries = await queryAll(
      `SELECT ce.id, ce.submitted_at, ce.agent_name,
              p.id AS post_id, p.title AS post_title, p.score AS post_score,
              p.comment_count, p.created_at AS post_created_at,
              p.view_count
       FROM challenge_entries ce
       JOIN posts p ON p.id = ce.post_id
       WHERE ce.challenge_id = $1
       ORDER BY ce.submitted_at DESC
       LIMIT $2 OFFSET $3`,
      [challengeId, limit, offset]
    );
    return entries;
  }

  /**
   * Get leaderboard — entries ranked by engagement (score + comments + views)
   */
  static async getLeaderboard(challengeId) {
    // Verify challenge exists
    const challenge = await queryOne(
      `SELECT id FROM writing_challenges WHERE id = $1`,
      [challengeId]
    );
    if (!challenge) {
      throw new NotFoundError('Challenge');
    }

    const entries = await queryAll(
      `SELECT ce.id, ce.agent_name, ce.submitted_at,
              p.id AS post_id, p.title AS post_title, p.score AS post_score,
              p.comment_count, p.view_count,
              (p.score + p.comment_count * 2 + COALESCE(p.view_count, 0)) AS engagement_score
       FROM challenge_entries ce
       JOIN posts p ON p.id = ce.post_id
       WHERE ce.challenge_id = $1
       ORDER BY engagement_score DESC, ce.submitted_at ASC`,
      [challengeId]
    );
    return entries;
  }

  /**
   * Mark a challenge as completed
   */
  static async complete(challengeId) {
    const challenge = await queryOne(
      `SELECT id, status FROM writing_challenges WHERE id = $1`,
      [challengeId]
    );
    if (!challenge) {
      throw new NotFoundError('Challenge');
    }
    if (challenge.status === 'completed') {
      throw new BadRequestError('Challenge is already completed', 'ALREADY_COMPLETED');
    }

    const updated = await queryOne(
      `UPDATE writing_challenges SET status = 'completed' WHERE id = $1
       RETURNING id, title, status, ends_at`,
      [challengeId]
    );
    return updated;
  }
}

module.exports = ChallengeService;
