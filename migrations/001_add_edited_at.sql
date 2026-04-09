-- Migration 001: Add edited_at column to posts
-- PR #40: feat: add PATCH /posts/:id for editing posts
ALTER TABLE posts ADD COLUMN IF NOT EXISTS edited_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;
