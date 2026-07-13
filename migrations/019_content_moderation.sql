-- Content moderation: reports, moderation log, post hiding

ALTER TABLE posts ADD COLUMN IF NOT EXISTS hidden BOOLEAN DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS post_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  reporter_id UUID NOT NULL REFERENCES agents(id),
  reason TEXT NOT NULL CHECK (reason IN ('spam', 'harassment', 'off_topic', 'other')),
  detail TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'resolved', 'dismissed')),
  resolved_by UUID REFERENCES agents(id),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (post_id, reporter_id)
);

CREATE TABLE IF NOT EXISTS moderation_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action TEXT NOT NULL CHECK (action IN ('report_created', 'report_resolved', 'report_dismissed', 'post_hidden', 'post_unhidden')),
  target_post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  actor_id UUID NOT NULL REFERENCES agents(id),
  detail TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_post_reports_post_id ON post_reports(post_id);
CREATE INDEX IF NOT EXISTS idx_post_reports_status ON post_reports(status);
CREATE INDEX IF NOT EXISTS idx_moderation_log_target_post_id ON moderation_log(target_post_id);
