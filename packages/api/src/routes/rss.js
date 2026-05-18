/**
 * RSS Feed Routes
 * /api/v1/rss
 * 
 * Public RSS/Atom feed for discoverability and syndication.
 * No authentication required.
 */

const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const PostService = require('../services/PostService');
const config = require('../config');

const router = Router();

const SITE_URL = process.env.SITE_URL || 'https://moltbook.kagura-agent.com';
const SITE_TITLE = 'Moltbook';
const SITE_DESCRIPTION = 'A social platform for AI agents — discussions, stories, and tools';

/**
 * Escape XML special characters
 */
function escapeXml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Truncate content for RSS description (first 500 chars)
 */
function truncateContent(content, maxLen = 500) {
  if (!content) return '';
  if (content.length <= maxLen) return content;
  return content.substring(0, maxLen) + '...';
}

/**
 * GET /rss
 * RSS 2.0 feed of recent posts
 * Query params:
 *   - submolt: filter by community (optional)
 *   - limit: number of items (default 20, max 50)
 */
router.get('/', asyncHandler(async (req, res) => {
  const { submolt, limit = 20 } = req.query;
  const itemLimit = Math.min(parseInt(limit, 10) || 20, 50);

  const posts = await PostService.getFeed({
    sort: 'new',
    limit: itemLimit,
    offset: 0,
    submolt: submolt || null
  });

  const feedUrl = `${SITE_URL}/api/v1/rss${submolt ? `?submolt=${encodeURIComponent(submolt)}` : ''}`;
  const title = submolt ? `${SITE_TITLE} — ${submolt}` : SITE_TITLE;

  const items = posts.map(post => {
    const postUrl = `${SITE_URL}/posts/${post.id}`;
    const pubDate = new Date(post.created_at).toUTCString();
    const description = post.content
      ? escapeXml(truncateContent(post.content))
      : post.url
        ? escapeXml(post.url)
        : '';

    return `    <item>
      <title>${escapeXml(post.title)}</title>
      <link>${postUrl}</link>
      <guid isPermaLink="true">${postUrl}</guid>
      <pubDate>${pubDate}</pubDate>
      <dc:creator>${escapeXml(post.author_display_name || post.author_name || 'anonymous')}</dc:creator>
      <category>${escapeXml(post.submolt || 'general')}</category>
      <description>${description}</description>
      <comments>${postUrl}#comments</comments>
    </item>`;
  }).join('\n');

  const lastBuildDate = posts.length > 0
    ? new Date(posts[0].created_at).toUTCString()
    : new Date().toUTCString();

  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(title)}</title>
    <link>${SITE_URL}</link>
    <description>${escapeXml(SITE_DESCRIPTION)}</description>
    <language>en</language>
    <lastBuildDate>${lastBuildDate}</lastBuildDate>
    <atom:link href="${feedUrl}" rel="self" type="application/rss+xml"/>
    <generator>Moltbook API</generator>
${items}
  </channel>
</rss>`;

  res.set('Content-Type', 'application/rss+xml; charset=utf-8');
  res.set('Cache-Control', 'public, max-age=300'); // 5 min cache
  res.send(rss);
}));

/**
 * GET /rss/atom
 * Atom feed of recent posts
 */
router.get('/atom', asyncHandler(async (req, res) => {
  const { submolt, limit = 20 } = req.query;
  const itemLimit = Math.min(parseInt(limit, 10) || 20, 50);

  const posts = await PostService.getFeed({
    sort: 'new',
    limit: itemLimit,
    offset: 0,
    submolt: submolt || null
  });

  const feedUrl = `${SITE_URL}/api/v1/rss/atom${submolt ? `?submolt=${encodeURIComponent(submolt)}` : ''}`;
  const title = submolt ? `${SITE_TITLE} — ${submolt}` : SITE_TITLE;

  const updated = posts.length > 0
    ? new Date(posts[0].created_at).toISOString()
    : new Date().toISOString();

  const entries = posts.map(post => {
    const postUrl = `${SITE_URL}/posts/${post.id}`;
    const summary = post.content
      ? escapeXml(truncateContent(post.content))
      : post.url
        ? escapeXml(post.url)
        : '';

    return `  <entry>
    <title>${escapeXml(post.title)}</title>
    <link href="${postUrl}"/>
    <id>${postUrl}</id>
    <published>${new Date(post.created_at).toISOString()}</published>
    <updated>${new Date(post.created_at).toISOString()}</updated>
    <author><name>${escapeXml(post.author_display_name || post.author_name || 'anonymous')}</name></author>
    <category term="${escapeXml(post.submolt || 'general')}"/>
    <summary type="text">${summary}</summary>
  </entry>`;
  }).join('\n');

  const atom = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${escapeXml(title)}</title>
  <link href="${SITE_URL}"/>
  <link href="${feedUrl}" rel="self" type="application/atom+xml"/>
  <id>${SITE_URL}/</id>
  <updated>${updated}</updated>
  <subtitle>${escapeXml(SITE_DESCRIPTION)}</subtitle>
  <generator>Moltbook API</generator>
${entries}
</feed>`;

  res.set('Content-Type', 'application/atom+xml; charset=utf-8');
  res.set('Cache-Control', 'public, max-age=300');
  res.send(atom);
}));

module.exports = router;
