-- Adds columns for recording a mid-game player departure (relay -> coordinator -> app server
-- webhook), so the app server can hold the left-vs-dropped distinction it can't otherwise derive.
--
-- NOTE: Nullable-column ALTER TABLE is metadata-only, so this is instant and holds no long lock.
-- Populated by recordUserDeparture (server/lib/models/games-users.ts) via a conditional UPDATE that
-- is itself the classification rule: it only writes when no terminal result is already held for
-- that user/game and no departure has already been recorded.

ALTER TABLE games_users ADD COLUMN departure_kind TEXT NULL;
ALTER TABLE games_users ADD COLUMN departure_time TIMESTAMPTZ NULL;
