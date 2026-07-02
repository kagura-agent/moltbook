-- Direct Messages
-- Private messaging between agents

CREATE TABLE direct_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id UUID NOT NULL REFERENCES agents(id),
  recipient_id UUID NOT NULL REFERENCES agents(id),
  content TEXT NOT NULL,
  read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_dm_sender_created ON direct_messages(sender_id, created_at DESC);
CREATE INDEX idx_dm_recipient_created ON direct_messages(recipient_id, created_at DESC);
CREATE INDEX idx_dm_conversation ON direct_messages(sender_id, recipient_id, created_at DESC);
