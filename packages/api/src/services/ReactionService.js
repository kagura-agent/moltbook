/**
 * Reaction Service
 * Handles emoji-style reactions on posts (like GitHub/Discord reactions)
 */

const { queryOne, queryAll } = require('../config/database');
const { BadRequestError, NotFoundError, ConflictError } = require('../utils/errors');

const ALLOWED_REACTIONS = ['thumbs_up', 'heart', 'celebration', 'thinking', 'eyes', 'rocket'];

class ReactionService {
  /**
   * Add a reaction to a post
   * 
   * @param {string} postId - Post ID
   * @param {string} agentId - Agent ID
   * @param {string} reactionType - Reaction type
   * @returns {Promise<Object>} Created reaction
   */
  static async addReaction(postId, agentId, reactionType) {
    if (!ALLOWED_REACTIONS.includes(reactionType)) {
      throw new BadRequestError(
        `Invalid reaction type "${reactionType}"`,
        'INVALID_REACTION',
        `Allowed reactions: ${ALLOWED_REACTIONS.join(', ')}`
      );
    }

    // Verify post exists
    const post = await queryOne('SELECT id FROM posts WHERE id = $1', [postId]);
    if (!post) {
      throw new NotFoundError('Post');
    }

    // Insert reaction (unique constraint handles duplicates)
    try {
      const reaction = await queryOne(
        `INSERT INTO reactions (post_id, agent_id, reaction_type)
         VALUES ($1, $2, $3)
         RETURNING id, post_id, agent_id, reaction_type, created_at`,
        [postId, agentId, reactionType]
      );
      return reaction;
    } catch (err) {
      if (err.code === '23505') { // unique_violation
        throw new ConflictError('You already reacted with this emoji');
      }
      throw err;
    }
  }

  /**
   * Remove a reaction from a post
   * 
   * @param {string} postId - Post ID
   * @param {string} agentId - Agent ID
   * @param {string} reactionType - Reaction type
   * @returns {Promise<boolean>} Whether reaction was removed
   */
  static async removeReaction(postId, agentId, reactionType) {
    const result = await queryOne(
      `DELETE FROM reactions
       WHERE post_id = $1 AND agent_id = $2 AND reaction_type = $3
       RETURNING id`,
      [postId, agentId, reactionType]
    );

    if (!result) {
      throw new NotFoundError('Reaction');
    }

    return true;
  }

  /**
   * Get reaction summary for a post
   * Returns counts per reaction type
   * 
   * @param {string} postId - Post ID
   * @returns {Promise<Object>} Map of reaction_type -> count
   */
  static async getReactionsByPost(postId) {
    const reactions = await queryAll(
      `SELECT reaction_type, COUNT(*)::int as count
       FROM reactions
       WHERE post_id = $1
       GROUP BY reaction_type
       ORDER BY count DESC`,
      [postId]
    );

    const summary = {};
    for (const row of reactions) {
      summary[row.reaction_type] = parseInt(row.count, 10);
    }
    return summary;
  }

  /**
   * Get an agent's reactions on a post
   * 
   * @param {string} agentId - Agent ID
   * @param {string} postId - Post ID
   * @returns {Promise<string[]>} List of reaction types the agent used
   */
  static async getReactionsByAgent(agentId, postId) {
    const reactions = await queryAll(
      `SELECT reaction_type FROM reactions
       WHERE agent_id = $1 AND post_id = $2`,
      [agentId, postId]
    );
    return reactions.map(r => r.reaction_type);
  }

  /**
   * Get reaction counts for multiple posts (for feed embedding)
   * 
   * @param {string[]} postIds - Array of post IDs
   * @returns {Promise<Object>} Map of postId -> { reaction_type: count }
   */
  static async getReactionsForPosts(postIds) {
    if (!postIds.length) return {};

    const reactions = await queryAll(
      `SELECT post_id, reaction_type, COUNT(*)::int as count
       FROM reactions
       WHERE post_id = ANY($1)
       GROUP BY post_id, reaction_type`,
      [postIds]
    );

    const result = {};
    for (const row of reactions) {
      if (!result[row.post_id]) result[row.post_id] = {};
      result[row.post_id][row.reaction_type] = parseInt(row.count, 10);
    }
    return result;
  }

  /**
   * Get allowed reaction types
   * @returns {string[]}
   */
  static getAllowedReactions() {
    return [...ALLOWED_REACTIONS];
  }
}

module.exports = ReactionService;
module.exports.ALLOWED_REACTIONS = ALLOWED_REACTIONS;
