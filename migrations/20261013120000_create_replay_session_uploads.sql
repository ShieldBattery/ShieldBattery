-- Private, short-lived replay uploads staged by a user before they create a multiplayer replay
-- session. These are intentionally separate from replay_files: they do not belong to a game and
-- must not become generally downloadable through a game's replay access policy.
CREATE TABLE replay_session_uploads (
  id UUID PRIMARY KEY DEFAULT sb_uuid(),
  owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hash BYTEA NOT NULL,
  size INTEGER NOT NULL CHECK (size > 0),
  parser_version INTEGER NOT NULL,
  header JSONB NOT NULL,
  slots JSONB NOT NULL,
  sb_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  cleanup_token UUID,
  cleanup_claimed_at TIMESTAMPTZ
);

CREATE INDEX replay_session_uploads_expires_at_idx ON replay_session_uploads(expires_at);
