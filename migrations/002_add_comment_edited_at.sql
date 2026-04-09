-- Migration 002: Add edited_at column to comments
-- PR #41: feat: add PATCH /comments/:id for editing comments
ALTER TABLE comments ADD COLUMN IF NOT EXISTS edited_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;
