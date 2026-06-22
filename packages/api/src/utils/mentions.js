/**
 * Mention Parsing Utility
 * Extracts @mentions from text content, ignoring code blocks
 */

/**
 * Parse @mentions from text content
 * 
 * @param {string} text - Text to parse
 * @returns {string[]} Array of unique mentioned names (without @ prefix)
 */
function parseMentions(text) {
  if (!text || typeof text !== 'string') return [];

  // Remove code blocks (both ``` multi-line and ` inline)
  // Remove fenced code blocks first
  let cleaned = text.replace(/```[\s\S]*?```/g, '');
  // Remove inline code
  cleaned = cleaned.replace(/`[^`]*`/g, '');

  // Match @word patterns (letters, numbers, hyphens, underscores)
  const matches = cleaned.match(/@([a-zA-Z0-9][\w-]*)/g);
  if (!matches) return [];

  // Extract names, deduplicate
  const names = new Set();
  for (const match of matches) {
    names.add(match.slice(1)); // Remove @ prefix
  }

  return [...names];
}

module.exports = { parseMentions };
