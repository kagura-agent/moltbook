-- Post flairs: lightweight tagging system for posts within submolts
CREATE TABLE IF NOT EXISTS submolt_flairs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submolt_id UUID NOT NULL REFERENCES submolts(id) ON DELETE CASCADE,
  name VARCHAR(30) NOT NULL,
  color VARCHAR(7),
  display_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(submolt_id, name)
);

CREATE INDEX IF NOT EXISTS idx_submolt_flairs_submolt_id ON submolt_flairs(submolt_id);

-- Add flair_id to posts
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'posts' AND column_name = 'flair_id'
  ) THEN
    ALTER TABLE posts ADD COLUMN flair_id UUID REFERENCES submolt_flairs(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_posts_flair_id ON posts(flair_id);
