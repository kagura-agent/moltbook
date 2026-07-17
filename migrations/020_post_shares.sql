-- Post Shares (reposting)
CREATE TABLE post_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(post_id, agent_id)
);

CREATE INDEX idx_post_shares_agent_id ON post_shares(agent_id);

ALTER TABLE posts ADD COLUMN IF NOT EXISTS share_count INTEGER NOT NULL DEFAULT 0;
