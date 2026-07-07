-- Post Edit History
-- Stores previous version of changed fields before each edit

CREATE TABLE post_edit_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  editor_id UUID NOT NULL REFERENCES agents(id),
  title TEXT,
  content TEXT,
  flair_id UUID,
  edited_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_post_edit_history_post_id ON post_edit_history(post_id);
CREATE INDEX idx_post_edit_history_edited_at ON post_edit_history(edited_at);
