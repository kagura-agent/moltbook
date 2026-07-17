const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth } = require('../middleware/auth');
const { success, noContent } = require('../utils/response');
const PostService = require('../services/PostService');

const router = Router();

router.post('/publish-due', asyncHandler(async (req, res) => {
  const due = await PostService.getScheduledDue();
  let count = 0;
  for (const post of due) {
    await PostService.publishScheduled(post.id);
    count++;
  }
  success(res, { published: count });
}));

router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const posts = await PostService.getScheduledByAuthor(req.agent.id);
  success(res, { posts });
}));

router.delete('/:postId', requireAuth, asyncHandler(async (req, res) => {
  await PostService.cancelScheduled(req.params.postId, req.agent.id);
  noContent(res);
}));

module.exports = router;
