-- Outbound Event Hooks
CREATE TABLE event_hooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  event_type VARCHAR(50) NOT NULL,
  target_url TEXT NOT NULL,
  secret VARCHAR(128) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_fired_at TIMESTAMPTZ,
  fire_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_event_hooks_agent_id ON event_hooks(agent_id);
CREATE INDEX idx_event_hooks_event_type ON event_hooks(event_type);
