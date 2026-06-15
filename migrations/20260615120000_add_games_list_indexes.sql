-- no-transaction

-- Indexes to serve the public global games list (server/lib/games/game-models.ts `getGames`), which
-- queries completed matchmaking games ordered by recency or game length. Without these, every page
-- view of that unauthenticated endpoint does a sequential scan + top-N sort over the entire `games`
-- table (the only other start_time index is partial on the *opposite* predicate, `game_length IS
-- NULL`, i.e. the currently-live games).
--
-- These build CONCURRENTLY (hence the `-- no-transaction` directive above, since CREATE INDEX
-- CONCURRENTLY can't run inside a transaction). Unlike the matchup indexes added in
-- 20260212000000, these are not empty at creation time -- there are already plenty of completed
-- matchmaking games -- so a regular CREATE INDEX would hold a lock that blocks result-reconciliation
-- writes to `games` for the entire build.
--
-- The `id` tiebreaker matches the ORDER BY in `getGames`/`getGamesForUser` so the index can fully
-- satisfy the ordering and keep pagination deterministic. Within these partial indexes `game_length`
-- is never NULL (it's written together with `results`), so NULLS positioning is irrelevant.

CREATE INDEX CONCURRENTLY idx_games_matchmaking_completed_start
ON games (start_time DESC, id DESC)
WHERE config->>'gameSource' = 'MATCHMAKING' AND results IS NOT NULL;

CREATE INDEX CONCURRENTLY idx_games_matchmaking_completed_length
ON games (game_length, start_time DESC, id DESC)
WHERE config->>'gameSource' = 'MATCHMAKING' AND results IS NOT NULL;
