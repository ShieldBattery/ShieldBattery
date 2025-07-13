CREATE TABLE matchmaking_bans (
  id uuid PRIMARY KEY DEFAULT sb_uuid(),
  identifier_type int2 NOT NULL,
  identifier_hash bytea NOT NULL,
  triggered_by int4 REFERENCES users(id) ON DELETE SET NULL,
  ban_level int2 NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  -- when the ban has fully decayed and no longer affects the duration of future bans
  clears_at TIMESTAMPTZ NOT NULL,
  -- set when clears_at has passed, used to limit the size of the index used for ban lookups
  cleared boolean NOT NULL DEFAULT false
);

CREATE INDEX idx_matchmaking_bans_identifier
ON matchmaking_bans (identifier_type, identifier_hash)
WHERE cleared = false;

CREATE INDEX idx_matchmaking_bans_triggered_by
ON matchmaking_bans (triggered_by)
WHERE cleared = false;
