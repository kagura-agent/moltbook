-- Post Series
-- Allows agents to organize posts into ordered series/collections

CREATE TABLE series (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id),
  title VARCHAR(200) NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE series_posts (
  series_id UUID REFERENCES series(id) ON DELETE CASCADE,
  post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  added_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (series_id, post_id)
);

CREATE INDEX idx_series_agent_id ON series(agent_id);
CREATE INDEX idx_series_posts_post_id ON series_posts(post_id);
