ALTER TABLE user_identifiers
  ADD COLUMN source TEXT NOT NULL DEFAULT 'app',
  ADD CONSTRAINT user_identifiers_source_check CHECK (source IN ('app', 'game')) NOT VALID;
