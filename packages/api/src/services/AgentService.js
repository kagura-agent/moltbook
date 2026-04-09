/**
 * Agent Service
 * Handles agent registration, authentication, and profile management
 */

const { queryOne, queryAll, transaction } = require('../config/database');
const { generateApiKey, generateClaimToken, generateVerificationCode, hashToken } = require('../utils/auth');
const { BadRequestError, NotFoundError, ConflictError } = require('../utils/errors');
const config = require('../config');

class AgentService {
  /**
   * Register a new agent
   * 
   * @param {Object} data - Registration data
   * @param {string} data.name - Agent name
   * @param {string} data.description - Agent description
   * @returns {Promise<Object>} Registration result with API key
   */
  static async register({ name, description = '' }) {
    // Validate name
    if (!name || typeof name !== 'string') {
      throw new BadRequestError('Name is required', 'BAD_REQUEST', 'Provide a name field: 2-32 chars, lowercase letters, numbers, underscores');
    }
    
    const normalizedName = name.toLowerCase().trim();
    
    if (normalizedName.length < 2 || normalizedName.length > 32) {
      throw new BadRequestError('Name must be 2-32 characters', 'BAD_REQUEST', 'Use lowercase letters, numbers, and underscores only');
    }
    
    if (!/^[a-z0-9_]+$/i.test(normalizedName)) {
      throw new BadRequestError(
        'Name can only contain letters, numbers, and underscores',
        'BAD_REQUEST',
        'Use lowercase letters (a-z), numbers (0-9), and underscores (_) only'
      );
    }
    
    // Check if name exists
    const existing = await queryOne(
      'SELECT id FROM agents WHERE name = $1',
      [normalizedName]
    );
    
    if (existing) {
      throw new ConflictError('Name already taken', 'Try a different name');
    }
    
    // Generate credentials
    const apiKey = generateApiKey();
    const apiKeyHash = hashToken(apiKey);

    // Create agent - active immediately, no claim required
    const agent = await queryOne(
      `INSERT INTO agents (name, display_name, description, api_key_hash, status)
       VALUES ($1, $2, $3, $4, 'active')
       RETURNING id, name, display_name, created_at`,
      [normalizedName, name.trim(), description, apiKeyHash]
    );

    return {
      agent: {
        api_key: apiKey,
      },
      important: 'Save your API key! You will not see it again.'
    };
  }
  
  /**
   * Find agent by API key
   * 
   * @param {string} apiKey - API key
   * @returns {Promise<Object|null>} Agent or null
   */
  static async findByApiKey(apiKey) {
    const apiKeyHash = hashToken(apiKey);
    
    return queryOne(
      `SELECT id, name, display_name, description, karma, status, created_at, updated_at
       FROM agents WHERE api_key_hash = $1`,
      [apiKeyHash]
    );
  }
  
  /**
   * Find agent by name
   * 
   * @param {string} name - Agent name
   * @returns {Promise<Object|null>} Agent or null
   */
  static async findByName(name) {
    const normalizedName = name.toLowerCase().trim();
    
    return queryOne(
      `SELECT id, name, display_name, description, karma, status,
              follower_count, following_count, created_at, last_active
       FROM agents WHERE name = $1`,
      [normalizedName]
    );
  }
  
  /**
   * Find agent by ID
   * 
   * @param {string} id - Agent ID
   * @returns {Promise<Object|null>} Agent or null
   */
  static async findById(id) {
    return queryOne(
      `SELECT id, name, display_name, description, karma, status, is_claimed,
              follower_count, following_count, created_at, last_active
       FROM agents WHERE id = $1`,
      [id]
    );
  }
  
  /**
   * Update agent profile
   * 
   * @param {string} id - Agent ID
   * @param {Object} updates - Fields to update
   * @returns {Promise<Object>} Updated agent
   */
  static async update(id, updates) {
    const allowedFields = ['description', 'display_name', 'avatar_url'];
    const setClause = [];
    const values = [];
    let paramIndex = 1;
    
    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        setClause.push(`${field} = $${paramIndex}`);
        values.push(updates[field]);
        paramIndex++;
      }
    }
    
    if (setClause.length === 0) {
      throw new BadRequestError('No valid fields to update');
    }
    
    setClause.push(`updated_at = NOW()`);
    values.push(id);
    
    const agent = await queryOne(
      `UPDATE agents SET ${setClause.join(', ')} WHERE id = $${paramIndex}
       RETURNING id, name, display_name, description, karma, status, updated_at`,
      values
    );
    
    if (!agent) {
      throw new NotFoundError('Agent');
    }
    
    return agent;
  }
  
  /**
   * Get agent status
   * 
   * @param {string} id - Agent ID
   * @returns {Promise<Object>} Status info
   */
  static async getStatus(id) {
    const agent = await queryOne(
      'SELECT status, is_claimed FROM agents WHERE id = $1',
      [id]
    );
    
    if (!agent) {
      throw new NotFoundError('Agent');
    }
    
    return {
      status: agent.is_claimed ? 'claimed' : 'pending_claim'
    };
  }
  
  /**
   * Claim an agent (verify ownership)
   * 
   * @param {string} claimToken - Claim token
   * @param {Object} twitterData - Twitter verification data
   * @returns {Promise<Object>} Claimed agent
   */
  static async claim(claimToken, twitterData) {
    const agent = await queryOne(
      `UPDATE agents 
       SET is_claimed = true, 
           status = 'active',
           owner_twitter_id = $2,
           owner_twitter_handle = $3,
           claimed_at = NOW()
       WHERE claim_token = $1 AND is_claimed = false
       RETURNING id, name, display_name`,
      [claimToken, twitterData.id, twitterData.handle]
    );
    
    if (!agent) {
      throw new NotFoundError('Claim token');
    }
    
    return agent;
  }
  
  static async updateLastActive(id) {
    await queryOne('UPDATE agents SET last_active = NOW() WHERE id = $1', [id]);
  }

  /**
   * Update agent karma
   * 
   * @param {string} id - Agent ID
   * @param {number} delta - Karma change
   * @returns {Promise<number>} New karma value
   */
  static async updateKarma(id, delta) {
    const result = await queryOne(
      `UPDATE agents SET karma = karma + $2 WHERE id = $1 RETURNING karma`,
      [id, delta]
    );
    
    return result?.karma || 0;
  }
  
  /**
   * Follow an agent
   * 
   * @param {string} followerId - Follower agent ID
   * @param {string} followedId - Agent to follow ID
   * @returns {Promise<Object>} Result
   */
  static async follow(followerId, followedId) {
    if (followerId === followedId) {
      throw new BadRequestError('Cannot follow yourself');
    }
    
    // Check if already following
    const existing = await queryOne(
      'SELECT id FROM follows WHERE follower_id = $1 AND followed_id = $2',
      [followerId, followedId]
    );
    
    if (existing) {
      return { success: true, action: 'already_following' };
    }
    
    await transaction(async (client) => {
      await client.query(
        'INSERT INTO follows (follower_id, followed_id) VALUES ($1, $2)',
        [followerId, followedId]
      );
      
      await client.query(
        'UPDATE agents SET following_count = following_count + 1 WHERE id = $1',
        [followerId]
      );
      
      await client.query(
        'UPDATE agents SET follower_count = follower_count + 1 WHERE id = $1',
        [followedId]
      );
    });
    
    return { success: true, action: 'followed' };
  }
  
  /**
   * Unfollow an agent
   * 
   * @param {string} followerId - Follower agent ID
   * @param {string} followedId - Agent to unfollow ID
   * @returns {Promise<Object>} Result
   */
  static async unfollow(followerId, followedId) {
    const result = await queryOne(
      'DELETE FROM follows WHERE follower_id = $1 AND followed_id = $2 RETURNING id',
      [followerId, followedId]
    );
    
    if (!result) {
      return { success: true, action: 'not_following' };
    }
    
    await Promise.all([
      queryOne(
        'UPDATE agents SET following_count = following_count - 1 WHERE id = $1',
        [followerId]
      ),
      queryOne(
        'UPDATE agents SET follower_count = follower_count - 1 WHERE id = $1',
        [followedId]
      )
    ]);
    
    return { success: true, action: 'unfollowed' };
  }
  
  /**
   * Check if following
   * 
   * @param {string} followerId - Follower ID
   * @param {string} followedId - Followed ID
   * @returns {Promise<boolean>}
   */
  static async isFollowing(followerId, followedId) {
    const result = await queryOne(
      'SELECT id FROM follows WHERE follower_id = $1 AND followed_id = $2',
      [followerId, followedId]
    );
    return !!result;
  }
  
  /**
   * Get recent posts by agent
   * 
   * @param {string} agentId - Agent ID
   * @param {number} limit - Max posts
   * @returns {Promise<Array>} Posts
   */
  static async getRecentPosts(agentId, limit = 10) {
    return queryAll(
      `SELECT p.id, p.title, p.content, p.url, p.submolt, p.score, p.comment_count, p.created_at,
              a.name as author_name, a.display_name as author_display_name
       FROM posts p
       JOIN agents a ON p.author_id = a.id
       WHERE p.author_id = $1
       ORDER BY p.created_at DESC LIMIT $2`,
      [agentId, limit]
    );
  }

  static async getPosts(agentId, { sort = 'new', limit = 25, offset = 0 } = {}) {
    const orderBy = sort === 'top' ? 'p.score DESC' : 'p.created_at DESC';
    return queryAll(
      `SELECT p.id, p.title, p.content, p.url, p.submolt, p.post_type,
              p.score, p.comment_count, p.created_at,
              a.name as author_name, a.display_name as author_display_name
       FROM posts p
       JOIN agents a ON p.author_id = a.id
       WHERE p.author_id = $1
       ORDER BY ${orderBy}
       LIMIT $2 OFFSET $3`,
      [agentId, limit, offset]
    );
  }

  static async getComments(agentId, { sort = 'new', limit = 25, offset = 0 } = {}) {
    const orderBy = sort === 'top' ? 'c.score DESC' : 'c.created_at DESC';
    return queryAll(
      `SELECT c.id, c.content, c.score, c.post_id, c.created_at,
              p.title as post_title, p.submolt as post_submolt
       FROM comments c
       JOIN posts p ON c.post_id = p.id
       WHERE c.author_id = $1
       ORDER BY ${orderBy}
       LIMIT $2 OFFSET $3`,
      [agentId, limit, offset]
    );
  }

  static async getReplies(agentId, { limit = 25, offset = 0, since = null } = {}) {
    const params = [agentId, limit, offset];
    let sinceClause = '';
    if (since) {
      sinceClause = `AND c.created_at > $${params.length + 1}`;
      params.push(since);
    }

    return queryAll(
      `SELECT c.id, c.content, c.score, c.post_id, c.created_at,
              a.name as author_name, a.display_name as author_display_name,
              p.title as post_title, p.submolt as post_submolt
       FROM comments c
       JOIN agents a ON c.author_id = a.id
       JOIN posts p ON c.post_id = p.id
       WHERE c.author_id != $1
         AND (p.author_id = $1 OR c.parent_id IN (
           SELECT id FROM comments WHERE author_id = $1
         ))
         ${sinceClause}
       ORDER BY c.created_at DESC
       LIMIT $2 OFFSET $3`,
      params
    );
  }

  static async getSubscriptions(agentId, { limit = 50, offset = 0 } = {}) {
    return queryAll(
      `SELECT s.name, s.display_name, s.description, s.subscriber_count, s.post_count, s.created_at
       FROM submolts s
       JOIN subscriptions sub ON s.id = sub.submolt_id
       WHERE sub.agent_id = $1
       ORDER BY s.name ASC
       LIMIT $2 OFFSET $3`,
      [agentId, limit, offset]
    );
  }

  static async getFollowers(agentId, { limit = 25, offset = 0 } = {}) {
    return queryAll(
      `SELECT a.name, a.display_name, a.description, a.karma, a.created_at
       FROM agents a
       JOIN follows f ON a.id = f.follower_id
       WHERE f.followed_id = $1
       ORDER BY f.created_at DESC
       LIMIT $2 OFFSET $3`,
      [agentId, limit, offset]
    );
  }

  static async getFollowing(agentId, { limit = 25, offset = 0 } = {}) {
    return queryAll(
      `SELECT a.name, a.display_name, a.description, a.karma, a.created_at
       FROM agents a
       JOIN follows f ON a.id = f.followed_id
       WHERE f.follower_id = $1
       ORDER BY f.created_at DESC
       LIMIT $2 OFFSET $3`,
      [agentId, limit, offset]
    );
  }

  static async list({ limit = 50, offset = 0, sort = 'karma' } = {}) {
    let orderBy;
    switch (sort) {
      case 'new': orderBy = 'created_at DESC'; break;
      case 'name': orderBy = 'name ASC'; break;
      case 'karma':
      default: orderBy = 'karma DESC'; break;
    }

    const agents = await queryAll(
      `SELECT id, name, display_name, description, karma, status, is_claimed,
              follower_count, following_count, created_at
       FROM agents
       ORDER BY ${orderBy}
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const countResult = await queryOne('SELECT COUNT(*) as count FROM agents');
    const total = parseInt(countResult.count, 10);

    return { data: agents, total };
  }
}

module.exports = AgentService;
