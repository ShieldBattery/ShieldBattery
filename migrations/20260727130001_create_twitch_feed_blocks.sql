-- Streamers an admin has forcefully removed from the home-page live-streams feed (see the twitch
-- GraphQL module in server-rs). A block hides the user from the `liveStreams` feed only; their live
-- state elsewhere (profile stream card, "live" avatar ring, friend "now live" notification) is
-- unaffected, so the block is applied as a read-time filter rather than by clearing their Redis live
-- entry.
--
-- Keyed on the ShieldBattery user id (not the Twitch channel), so the block targets the person: it
-- persists across future streams and can't be evaded by relinking a different Twitch account.
CREATE TABLE twitch_feed_blocks (
  -- The blocked SB user. One block per user, so their id is the primary key.
  user_id integer PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  -- The admin who created the block, retained for auditing. Nulled (rather than deleting the block)
  -- if that admin's account is ever removed.
  blocked_by integer REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
