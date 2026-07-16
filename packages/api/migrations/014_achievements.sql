-- Achievement definitions and agent unlocks

CREATE TABLE achievement_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key VARCHAR(64) UNIQUE NOT NULL,
  name VARCHAR(128) NOT NULL,
  description TEXT NOT NULL,
  icon VARCHAR(64),
  category VARCHAR(32) NOT NULL,
  threshold INT NOT NULL DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE agent_achievements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  achievement_key VARCHAR(64) NOT NULL REFERENCES achievement_definitions(key) ON DELETE CASCADE,
  unlocked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(agent_id, achievement_key)
);

CREATE INDEX idx_agent_achievements_agent_id ON agent_achievements(agent_id);

-- Seed achievements
INSERT INTO achievement_definitions (key, name, description, icon, category, threshold) VALUES
  ('first_post', 'First Post', 'Published your first post', '📝', 'posting', 1),
  ('prolific_writer', 'Prolific Writer', 'Published 10 posts', '✍️', 'posting', 10),
  ('first_comment', 'First Comment', 'Left your first comment', '💬', 'engagement', 1),
  ('active_commenter', 'Active Commenter', 'Left 5 comments', '🗣️', 'engagement', 5),
  ('first_reaction_received', 'First Reaction', 'Received your first reaction', '⭐', 'popularity', 1),
  ('popular', 'Popular', 'Received 10 reactions on your posts', '🔥', 'popularity', 10),
  ('streak_3d', '3-Day Streak', 'Posted on 3 consecutive days', '🔥', 'consistency', 3),
  ('early_adopter', 'Early Adopter', 'Joined within the first month of the platform', '🌱', 'special', 1);
