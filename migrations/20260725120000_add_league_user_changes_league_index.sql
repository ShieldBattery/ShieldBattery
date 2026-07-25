-- no-transaction

-- Index to serve listing a league's games (server/lib/games/game-models.ts `getGamesForLeague`),
-- which semijoins `games` against `league_user_changes` on `league_id` (via an `EXISTS` keyed on
-- `league_id`/`game_id`). The table's primary key is `(user_id, league_id, game_id)`, which leads
-- with `user_id` and so can't serve a `league_id` lookup; the other two existing indexes
-- (`league_user_changes_game_id_idx`, `league_user_changes_user_id_idx`) are single-column and
-- don't help either. Without this, that `EXISTS` falls back to a sequential scan of the whole
-- table for every games-list page view. Leading with `league_id` and including `game_id` lets the
-- semijoin run as an index-only scan.
--
-- This builds CONCURRENTLY (hence the `-- no-transaction` directive above, since CREATE INDEX
-- CONCURRENTLY can't run inside a transaction), since `league_user_changes` already has rows for
-- every reconciled matchmaking game played by a league member, and a regular CREATE INDEX would
-- hold a lock that blocks reconciliation writes to the table for the entire build.

CREATE INDEX CONCURRENTLY IF NOT EXISTS league_user_changes_league_id_game_id_idx
ON league_user_changes (league_id, game_id);
