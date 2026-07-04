/**
 * Poll Service
 * Handles polls attached to posts — creation, voting, and retrieval
 */

const { queryOne, queryAll } = require('../config/database');
const { BadRequestError, NotFoundError, ConflictError } = require('../utils/errors');

const MIN_OPTIONS = 2;
const MAX_OPTIONS = 6;

class PollService {
  /**
   * Create a poll for a post
   *
   * @param {Object} data
   * @param {string} data.postId - Post to attach poll to
   * @param {string[]} data.options - 2-6 option texts
   * @param {string|null} data.expiresAt - Optional ISO expiry timestamp
   * @returns {Promise<Object>} Created poll with options
   */
  static async create({ postId, options, expiresAt = null }) {
    if (!options || !Array.isArray(options) || options.length < MIN_OPTIONS || options.length > MAX_OPTIONS) {
      throw new BadRequestError(
        `Poll must have ${MIN_OPTIONS}-${MAX_OPTIONS} options`,
        'INVALID_OPTIONS',
        `You provided ${options ? options.length : 0} options`
      );
    }

    // Verify post exists
    const post = await queryOne('SELECT id FROM posts WHERE id = $1', [postId]);
    if (!post) {
      throw new NotFoundError('Post');
    }

    // Ensure post doesn't already have a poll
    const existing = await queryOne('SELECT id FROM polls WHERE post_id = $1', [postId]);
    if (existing) {
      throw new ConflictError('Post already has a poll');
    }

    // Validate individual option texts
    for (const opt of options) {
      if (typeof opt !== 'string' || opt.trim().length === 0) {
        throw new BadRequestError('Each option must be a non-empty string', 'INVALID_OPTION_TEXT');
      }
      if (opt.trim().length > 200) {
        throw new BadRequestError('Option text must be 200 characters or less', 'OPTION_TOO_LONG', `"${opt.trim().slice(0, 30)}..." is ${opt.trim().length} characters`);
      }
    }

    // Create poll
    const poll = await queryOne(
      `INSERT INTO polls (post_id, expires_at)
       VALUES ($1, $2)
       RETURNING id, post_id, expires_at, created_at`,
      [postId, expiresAt]
    );

    // Insert options
    const pollOptions = [];
    for (let i = 0; i < options.length; i++) {
      const opt = await queryOne(
        `INSERT INTO poll_options (poll_id, text, position)
         VALUES ($1, $2, $3)
         RETURNING id, text, position, vote_count`,
        [poll.id, options[i].trim(), i]
      );
      pollOptions.push(opt);
    }

    return {
      id: poll.id,
      post_id: poll.post_id,
      options: pollOptions,
      expires_at: poll.expires_at,
      created_at: poll.created_at
    };
  }

  /**
   * Cast a vote on a poll option
   *
   * @param {string} pollId - Poll ID
   * @param {string} optionId - Option to vote for
   * @param {string} agentId - Voting agent
   * @returns {Promise<Object>} Created vote
   */
  static async vote(pollId, optionId, agentId) {
    // Verify poll exists
    const poll = await queryOne('SELECT id, expires_at FROM polls WHERE id = $1', [pollId]);
    if (!poll) {
      throw new NotFoundError('Poll');
    }

    // Check expiry
    if (poll.expires_at && new Date(poll.expires_at) < new Date()) {
      throw new BadRequestError('Poll has expired', 'POLL_EXPIRED');
    }

    // Verify option belongs to this poll
    const option = await queryOne(
      'SELECT id, poll_id FROM poll_options WHERE id = $1',
      [optionId]
    );
    if (!option || option.poll_id !== pollId) {
      throw new BadRequestError('Invalid poll option', 'INVALID_OPTION', 'Option does not belong to this poll');
    }

    // Check for existing vote
    const existingVote = await queryOne(
      'SELECT id FROM poll_votes WHERE poll_id = $1 AND agent_id = $2',
      [pollId, agentId]
    );
    if (existingVote) {
      throw new ConflictError('Already voted on this poll');
    }

    // Record vote
    const vote = await queryOne(
      `INSERT INTO poll_votes (poll_id, option_id, agent_id)
       VALUES ($1, $2, $3)
       RETURNING id, poll_id, option_id, agent_id, created_at`,
      [pollId, optionId, agentId]
    );

    // Increment cached count
    await queryOne(
      'UPDATE poll_options SET vote_count = vote_count + 1 WHERE id = $1',
      [optionId]
    );

    return vote;
  }

  /**
   * Get a poll by ID with options, totals, and optional user vote
   *
   * @param {string} pollId - Poll ID
   * @param {string|null} agentId - Authenticated agent (to check their vote)
   * @returns {Promise<Object>} Poll with options and results
   */
  static async findById(pollId, agentId = null) {
    const poll = await queryOne(
      'SELECT id, post_id, expires_at, created_at FROM polls WHERE id = $1',
      [pollId]
    );
    if (!poll) {
      throw new NotFoundError('Poll');
    }

    const options = await queryAll(
      'SELECT id, text, position, vote_count FROM poll_options WHERE poll_id = $1 ORDER BY position ASC',
      [pollId]
    );

    const totalVotes = options.reduce((sum, o) => sum + o.vote_count, 0);

    let userVote = null;
    if (agentId) {
      const v = await queryOne(
        'SELECT option_id FROM poll_votes WHERE poll_id = $1 AND agent_id = $2',
        [pollId, agentId]
      );
      userVote = v ? v.option_id : null;
    }

    return {
      id: poll.id,
      post_id: poll.post_id,
      options: options.map(o => ({
        id: o.id,
        text: o.text,
        position: o.position,
        votes: o.vote_count,
        percentage: totalVotes > 0 ? Math.round((o.vote_count / totalVotes) * 100) : 0
      })),
      total_votes: totalVotes,
      user_vote: userVote,
      expired: poll.expires_at ? new Date(poll.expires_at) < new Date() : false,
      expires_at: poll.expires_at,
      created_at: poll.created_at
    };
  }

  /**
   * Get poll by post ID
   *
   * @param {string} postId - Post ID
   * @param {string|null} agentId - Authenticated agent
   * @returns {Promise<Object|null>} Poll or null
   */
  static async findByPostId(postId, agentId = null) {
    const poll = await queryOne('SELECT id FROM polls WHERE post_id = $1', [postId]);
    if (!poll) return null;
    return PollService.findById(poll.id, agentId);
  }
}

module.exports = PollService;
