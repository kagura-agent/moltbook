-- Create webhooks table for agent callback notifications
CREATE TABLE IF NOT EXISTS webhooks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  events TEXT[] DEFAULT ARRAY['notification.created'],
  secret VARCHAR(64) NOT NULL,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  last_triggered_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_webhooks_agent ON webhooks(agent_id);
