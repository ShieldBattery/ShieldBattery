-- no-transaction

-- Index to serve the public global games list (server/lib/games/game-models.ts `getGames`), which
-- queries completed matchmaking games ordered by recency. Without it, every page view of that
-- unauthenticated endpoint does a sequential scan + top-N sort over the entire `games` table (the
-- only other start_time index is partial on the *opposite* predicate, `game_length IS NULL`, i.e.
-- the currently-live games).
--
-- This builds CONCURRENTLY (hence the `-- no-transaction` directive above, since CREATE INDEX
-- CONCURRENTLY can't run inside a transaction). Unlike the matchup indexes added in
-- 20260212000000, this is not empty at creation time -- there are already plenty of completed
-- matchmaking games -- so a regular CREATE INDEX would hold a lock that blocks
-- result-reconciliation writes to `games` for the entire build.
--
-- The companion index for the game_length sorts lives in the next migration (20260615120001).
-- They're separate files because sqlx sends each migration's body to Postgres as a single
-- multi-statement simple query, which runs in an implicit transaction block -- so each CREATE INDEX
-- CONCURRENTLY must be the only statement in its migration.
--
-- The `id` tiebreaker matches the ORDER BY in `getGames`/`getGamesForUser` so the index can fully
-- satisfy the ordering and keep pagination deterministic. Within this partial index `game_length`
-- is never NULL (it's written together with `results`), so NULLS positioning is irrelevant.

CREATE INDEX CONCURRENTLY idx_games_matchmaking_completed_start
ON games (start_time DESC, id DESC)
WHERE config->>'gameSource' = 'MATCHMAKING' AND results IS NOT NULL;
