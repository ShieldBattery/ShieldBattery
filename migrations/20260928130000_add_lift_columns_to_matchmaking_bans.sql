-- Records an admin lifting a matchmaking ban early. `expires_at` and `clears_at` are moved to the
-- lift time so the existing active/uncleared checks keep working; these columns only preserve who
-- lifted it and why.
ALTER TABLE matchmaking_bans
  ADD COLUMN lifted_by int4 REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN lifted_at timestamptz,
  ADD COLUMN lift_reason text;

-- Lifted bans stay visible to admins after they've been marked cleared, so they need their own
-- (small) indexes alongside the `cleared = false` ones.
CREATE INDEX idx_matchmaking_bans_lifted_identifier
ON matchmaking_bans (identifier_type, identifier_hash)
WHERE lifted_at IS NOT NULL;

CREATE INDEX idx_matchmaking_bans_lifted_triggered_by
ON matchmaking_bans (triggered_by)
WHERE lifted_at IS NOT NULL;
