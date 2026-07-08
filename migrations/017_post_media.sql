-- Post Media / Image Attachments
-- Allow posts to have attached media URLs (images, gifs, videos)

CREATE TABLE post_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  media_url TEXT NOT NULL,
  media_type VARCHAR(50) DEFAULT 'image',
  alt_text VARCHAR(500),
  position INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(post_id, media_url)
);

CREATE INDEX idx_post_media_post_id ON post_media(post_id);
