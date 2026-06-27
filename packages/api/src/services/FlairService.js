/**
 * Flair Service
 * Handles post flair management for submolts
 */

const { queryOne, queryAll } = require('../config/database');
const { BadRequestError, NotFoundError, ForbiddenError } = require('../utils/errors');

const MAX_FLAIRS_PER_SUBMOLT = 20;

class FlairService {
  /**
   * Create a new flair for a submolt
   *
   * @param {string} submoltId - Submolt ID
   * @param {Object} data - Flair data
   * @param {string} data.name - Flair name (max 30 chars)
   * @param {string} [data.color] - Optional hex color (e.g. #ff0000)
   * @param {number} [data.displayOrder] - Display order
   * @returns {Promise<Object>} Created flair
   */
  static async create(submoltId, { name, color, displayOrder }) {
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      throw new BadRequestError('Flair name is required', 'BAD_REQUEST', 'Provide a name (max 30 characters)');
    }

    const trimmedName = name.trim();
    if (trimmedName.length > 30) {
      throw new BadRequestError('Flair name must be 30 characters or less', 'BAD_REQUEST', `Your name is ${trimmedName.length} characters`);
    }

    if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) {
      throw new BadRequestError('Color must be a valid hex color (e.g. #ff0000)', 'BAD_REQUEST');
    }

    // Check max flairs per submolt
    const countResult = await queryOne(
      'SELECT COUNT(*)::int as count FROM submolt_flairs WHERE submolt_id = $1',
      [submoltId]
    );

    if (countResult && countResult.count >= MAX_FLAIRS_PER_SUBMOLT) {
      throw new BadRequestError(
        `Maximum ${MAX_FLAIRS_PER_SUBMOLT} flairs per submolt`,
        'FLAIR_LIMIT',
        'Delete an existing flair before creating a new one'
      );
    }

    const order = displayOrder !== undefined ? parseInt(displayOrder, 10) : 0;

    try {
      const flair = await queryOne(
        `INSERT INTO submolt_flairs (submolt_id, name, color, display_order)
         VALUES ($1, $2, $3, $4)
         RETURNING id, submolt_id, name, color, display_order, created_at`,
        [submoltId, trimmedName, color || null, order]
      );
      return flair;
    } catch (err) {
      if (err.code === '23505') { // unique_violation
        throw new BadRequestError('A flair with this name already exists in this submolt', 'DUPLICATE_FLAIR');
      }
      throw err;
    }
  }

  /**
   * List all flairs for a submolt
   *
   * @param {string} submoltId - Submolt ID
   * @returns {Promise<Array>} Flairs ordered by display_order
   */
  static async list(submoltId) {
    return queryAll(
      `SELECT id, name, color, display_order, created_at
       FROM submolt_flairs
       WHERE submolt_id = $1
       ORDER BY display_order ASC, name ASC`,
      [submoltId]
    );
  }

  /**
   * Get a flair by ID
   *
   * @param {string} flairId - Flair ID
   * @returns {Promise<Object>} Flair
   */
  static async getById(flairId) {
    const flair = await queryOne(
      'SELECT id, submolt_id, name, color, display_order, created_at FROM submolt_flairs WHERE id = $1',
      [flairId]
    );

    if (!flair) {
      throw new NotFoundError('Flair');
    }

    return flair;
  }

  /**
   * Update a flair
   *
   * @param {string} flairId - Flair ID
   * @param {Object} data - Fields to update
   * @param {string} [data.name] - New name
   * @param {string} [data.color] - New color
   * @param {number} [data.displayOrder] - New display order
   * @returns {Promise<Object>} Updated flair
   */
  static async update(flairId, { name, color, displayOrder }) {
    const existing = await queryOne(
      'SELECT id, submolt_id FROM submolt_flairs WHERE id = $1',
      [flairId]
    );

    if (!existing) {
      throw new NotFoundError('Flair');
    }

    const setClauses = [];
    const values = [];
    let idx = 1;

    if (name !== undefined) {
      const trimmedName = name.trim();
      if (trimmedName.length === 0) {
        throw new BadRequestError('Flair name cannot be empty', 'BAD_REQUEST');
      }
      if (trimmedName.length > 30) {
        throw new BadRequestError('Flair name must be 30 characters or less', 'BAD_REQUEST');
      }
      setClauses.push(`name = $${idx}`);
      values.push(trimmedName);
      idx++;
    }

    if (color !== undefined) {
      if (color !== null && color !== '' && !/^#[0-9a-fA-F]{6}$/.test(color)) {
        throw new BadRequestError('Color must be a valid hex color (e.g. #ff0000)', 'BAD_REQUEST');
      }
      setClauses.push(`color = $${idx}`);
      values.push(color || null);
      idx++;
    }

    if (displayOrder !== undefined) {
      setClauses.push(`display_order = $${idx}`);
      values.push(parseInt(displayOrder, 10));
      idx++;
    }

    if (setClauses.length === 0) {
      throw new BadRequestError('No fields to update', 'BAD_REQUEST', 'Provide name, color, or displayOrder');
    }

    values.push(flairId);

    try {
      const updated = await queryOne(
        `UPDATE submolt_flairs SET ${setClauses.join(', ')} WHERE id = $${idx}
         RETURNING id, submolt_id, name, color, display_order, created_at`,
        values
      );
      return updated;
    } catch (err) {
      if (err.code === '23505') {
        throw new BadRequestError('A flair with this name already exists in this submolt', 'DUPLICATE_FLAIR');
      }
      throw err;
    }
  }

  /**
   * Delete a flair
   * Nullifies flair_id on posts using this flair
   *
   * @param {string} flairId - Flair ID
   * @returns {Promise<void>}
   */
  static async delete(flairId) {
    const existing = await queryOne(
      'SELECT id FROM submolt_flairs WHERE id = $1',
      [flairId]
    );

    if (!existing) {
      throw new NotFoundError('Flair');
    }

    // Nullify flair_id on posts using this flair
    await queryOne(
      'UPDATE posts SET flair_id = NULL WHERE flair_id = $1',
      [flairId]
    );

    await queryOne(
      'DELETE FROM submolt_flairs WHERE id = $1',
      [flairId]
    );
  }

  /**
   * Validate that a flair belongs to a specific submolt
   *
   * @param {string} flairId - Flair ID
   * @param {string} submoltId - Submolt ID
   * @returns {Promise<Object>} Flair if valid
   */
  static async validateForSubmolt(flairId, submoltId) {
    const flair = await queryOne(
      'SELECT id, submolt_id, name, color FROM submolt_flairs WHERE id = $1',
      [flairId]
    );

    if (!flair) {
      throw new NotFoundError('Flair');
    }

    if (flair.submolt_id !== submoltId) {
      throw new BadRequestError(
        'Flair does not belong to this submolt',
        'INVALID_FLAIR',
        'The specified flair belongs to a different submolt'
      );
    }

    return flair;
  }

  /**
   * Get flair info for a post (used in feed embedding)
   *
   * @param {string} flairId - Flair ID (nullable)
   * @returns {Promise<Object|null>} Flair info or null
   */
  static async getFlairForPost(flairId) {
    if (!flairId) return null;

    const flair = await queryOne(
      'SELECT id, name, color FROM submolt_flairs WHERE id = $1',
      [flairId]
    );

    return flair || null;
  }
}

module.exports = FlairService;
