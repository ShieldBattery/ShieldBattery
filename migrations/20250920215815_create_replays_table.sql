-- This is similar to `uploaded_maps`, in that it corresponds to files with deduped contents. For
-- now we don't need an indirection layer on this (since these are only automated uploads after
-- matchmaking games), but if/when we allow arbitrary user uploads/descriptions/etc. we probably
-- need another table to point to these with that extra data.
CREATE TABLE replay_files (
  -- files will be stored in our storage based on this ID
  id UUID PRIMARY KEY DEFAULT sb_uuid(),
  -- hash+size should uniquely identify the contents of a file. hash should generally work, but
  -- adding size should generally future-proof against collision attacks. We use `id` as the PK
  -- because it is more convenient for some usages (e.g. graphql)
  hash BYTEA NOT NULL,
  -- file size in bytes
  size INT NOT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  uploaded_by INT REFERENCES users(id) ON DELETE SET NULL,
  -- version that should be implemented every time the data format changes in a way that old replays
  -- need to be re-parsed
  parser_version INT NOT NULL DEFAULT 1,

  -- need enough info that if an uploaded replay is a dupe we don't need to re-retrieve this one
  header JSONB NOT NULL,
  slots JSONB NOT NULL,
  sb_data JSONB,

  UNIQUE(hash, size)
);

ALTER TABLE games_users
  ADD COLUMN replay_file_id UUID REFERENCES replay_files(id) ON DELETE SET NULL;
