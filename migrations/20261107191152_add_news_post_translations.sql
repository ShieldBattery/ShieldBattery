ALTER TABLE news_posts
  ADD COLUMN translations JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(translations) = 'array');

ALTER TABLE news_post_edits
  ADD COLUMN translations JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(translations) = 'array');
