-- What caused a ban, independent of the user-facing reason text. Bans applied to accounts linked by
-- shared identifiers keep the source of the ban that caused them and record its target in
-- `cascaded_from`. `game_id` is the game that triggered an automated ban, if there was one.
ALTER TABLE user_bans
  ADD COLUMN source TEXT CHECK (source IN ('admin', 'banEvasion', 'clientIntegrity', 'automated')),
  ADD COLUMN cascaded_from int4 REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN game_id UUID;

-- Automated bans were only distinguishable by the reason text their writers used.
UPDATE user_bans SET source = CASE
  WHEN banned_by IS NOT NULL THEN 'admin'
  WHEN reason = 'ban evasion' THEN 'banEvasion'
  WHEN reason = 'Client integrity violation' THEN 'clientIntegrity'
  ELSE 'automated'
END;

-- Ban requests record which of their bans belongs to the target, so the rest are linked accounts.
UPDATE user_bans b
SET
  cascaded_from = CASE WHEN b.id <> r.ban_id THEN r.target_id END,
  game_id = r.game_id
FROM user_ban_requests r
WHERE b.id = ANY(r.ban_ids);

ALTER TABLE user_bans ALTER COLUMN source SET NOT NULL;

-- Deploys run migrations while the previous server version is still serving, and its inserts don't
-- set `source`. This derives it the same way as the backfill above rather than failing those bans.
-- NOTE(tec27): Can be dropped once no server older than this column is running.
CREATE FUNCTION user_bans_derive_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.source IS NULL THEN
    NEW.source := CASE
      WHEN NEW.banned_by IS NOT NULL THEN 'admin'
      WHEN NEW.reason = 'ban evasion' THEN 'banEvasion'
      WHEN NEW.reason = 'Client integrity violation' THEN 'clientIntegrity'
      ELSE 'automated'
    END;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER user_bans_derive_source BEFORE INSERT ON user_bans
  FOR EACH ROW EXECUTE FUNCTION user_bans_derive_source();

-- The account whose restriction caused this one, for restrictions applied to linked accounts or
-- carried onto an account through shared identifiers.
ALTER TABLE user_restrictions
  ADD COLUMN cascaded_from int4 REFERENCES users(id) ON DELETE SET NULL;

-- Rows from a single matchmaking ban share `created_at` and `triggered_by`, one per identifier.
CREATE INDEX idx_matchmaking_bans_created_at ON matchmaking_bans (created_at DESC, triggered_by);
