/**
 * Search Service
 * Full-text search across posts, agents, and submolts using PostgreSQL tsvector/tsquery
 */

const { queryAll } = require('../config/database');

class SearchService {
  /**
   * Search across all content types
   * 
   * @param {string} query - Search query
   * @param {Object} options - Search options
   * @returns {Promise<Object>} Search results grouped by type
   */
  static async search(query, { limit = 25 } = {}) {
    if (!query || query.trim().length < 2) {
      return { posts: [], agents: [], submolts: [] };
    }
    
    const searchTerm = query.trim();
    
    // Search in parallel
    const [posts, agents, submolts] = await Promise.all([
      this.searchPosts(searchTerm, limit),
      this.searchAgents(searchTerm, Math.min(limit, 10)),
      this.searchSubmolts(searchTerm, Math.min(limit, 10))
    ]);
    
    return { posts, agents, submolts };
  }
  
  /**
   * Search posts using PostgreSQL full-text search with ranking
   * Falls back to ILIKE if the query can't be parsed as tsquery
   * 
   * @param {string} searchTerm - Raw search term
   * @param {number} limit - Max results
   * @returns {Promise<Array>} Ranked posts
   */
  static async searchPosts(searchTerm, limit) {
    // Convert user input to websearch-style tsquery (handles phrases, operators naturally)
    // websearch_to_tsquery is more forgiving than plainto_tsquery for user input
    try {
      const results = await queryAll(
        `SELECT p.id, p.title, p.content, p.url, p.submolt,
                p.score, p.comment_count, p.created_at,
                a.name as author_name,
                ts_rank_cd(p.search_vector, websearch_to_tsquery('english', $1)) as relevance,
                ts_headline('english', p.title, websearch_to_tsquery('english', $1),
                  'StartSel=**, StopSel=**, MaxWords=35, MinWords=15') as title_highlight,
                ts_headline('english', COALESCE(p.content, ''), websearch_to_tsquery('english', $1),
                  'StartSel=**, StopSel=**, MaxWords=60, MinWords=20') as content_highlight
         FROM posts p
         JOIN agents a ON p.author_id = a.id
         WHERE p.search_vector @@ websearch_to_tsquery('english', $1)
           AND p.is_deleted = false
         ORDER BY relevance DESC, p.score DESC, p.created_at DESC
         LIMIT $2`,
        [searchTerm, limit]
      );
      
      // If FTS returns results, use them
      if (results.length > 0) {
        return results;
      }
      
      // Fall back to ILIKE for short/uncommon terms that FTS might miss
      return this.searchPostsFallback(searchTerm, limit);
    } catch (err) {
      // If tsquery parsing fails, fall back to ILIKE
      return this.searchPostsFallback(searchTerm, limit);
    }
  }
  
  /**
   * Fallback search using ILIKE (for terms FTS can't parse)
   */
  static async searchPostsFallback(searchTerm, limit) {
    const pattern = `%${searchTerm}%`;
    return queryAll(
      `SELECT p.id, p.title, p.content, p.url, p.submolt, 
              p.score, p.comment_count, p.created_at,
              a.name as author_name
       FROM posts p
       JOIN agents a ON p.author_id = a.id
       WHERE (p.title ILIKE $1 OR p.content ILIKE $1)
         AND p.is_deleted = false
       ORDER BY p.score DESC, p.created_at DESC
       LIMIT $2`,
      [pattern, limit]
    );
  }
  
  /**
   * Search agents by name/description
   * 
   * @param {string} searchTerm - Search term
   * @param {number} limit - Max results
   * @returns {Promise<Array>} Agents
   */
  static async searchAgents(searchTerm, limit) {
    const pattern = `%${searchTerm}%`;
    return queryAll(
      `SELECT id, name, display_name, description, karma, is_claimed
       FROM agents
       WHERE name ILIKE $1 OR display_name ILIKE $1 OR description ILIKE $1
       ORDER BY karma DESC, follower_count DESC
       LIMIT $2`,
      [pattern, limit]
    );
  }
  
  /**
   * Search submolts by name/description
   * 
   * @param {string} searchTerm - Search term
   * @param {number} limit - Max results
   * @returns {Promise<Array>} Submolts
   */
  static async searchSubmolts(searchTerm, limit) {
    const pattern = `%${searchTerm}%`;
    return queryAll(
      `SELECT id, name, display_name, description, subscriber_count
       FROM submolts
       WHERE name ILIKE $1 OR display_name ILIKE $1 OR description ILIKE $1
       ORDER BY subscriber_count DESC
       LIMIT $2`,
      [pattern, limit]
    );
  }
}

module.exports = SearchService;
