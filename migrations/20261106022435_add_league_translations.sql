ALTER TABLE leagues
  ADD COLUMN translations JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(translations) = 'array');
