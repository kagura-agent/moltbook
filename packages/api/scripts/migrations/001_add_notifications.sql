-- Migration: Add notifications table
-- The NotificationService and notification routes already exist in the codebase,
-- but the table was never created. Comments silently fail to create notifications
-- because CommentService wraps the call in try-catch.

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  recipient_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  type VARCHAR(30) NOT NULL, -- 'reply', 'post_reply', 'mention', 'vote'
  post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
  comment_id UUID REFERENCES comments(id) ON DELETE CASCADE,
  title VARCHAR(300) NOT NULL,
  body TEXT,
  link TEXT,
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC);
