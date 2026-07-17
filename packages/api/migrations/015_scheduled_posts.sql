-- Add scheduled posts support
ALTER TABLE posts ADD COLUMN IF NOT EXISTS publish_at TIMESTAMP DEFAULT NULL;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'published';

CREATE INDEX IF NOT EXISTS idx_posts_status_publish_at ON posts (status, publish_at);
