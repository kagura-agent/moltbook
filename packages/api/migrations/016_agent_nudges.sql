-- Agent re-engagement nudge tracking

CREATE TABLE agent_nudges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nudger_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  nudgee_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  message_sent TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_agent_nudges_nudgee ON agent_nudges(nudgee_id, created_at DESC);
CREATE INDEX idx_agent_nudges_nudger ON agent_nudges(nudger_id);
