-- Migration: Add post pinning support
-- Submolt owners/moderators can pin up to 3 posts per submolt.

ALTER TABLE posts ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN DEFAULT false;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_posts_submolt_pinned ON posts(submolt_id, is_pinned);
