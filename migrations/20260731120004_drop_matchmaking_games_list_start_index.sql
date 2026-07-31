-- no-transaction

-- Drops the matchmaking-only games-list index: `idx_games_public_completed_start` (20260731120000)
-- indexes a superset of these rows with the same ordering, and the matchmaking-only predicate
-- implies that index's, so the planner serves the Ranked filter from it -- listed lobby games are a
-- small fraction of the table, making the ordered walk nearly identical. Keeping both pairs would
-- double the index maintenance for every completed matchmaking game for a marginal planner win.
--
-- Runs after 20260731120000 has built its replacement, so there is no window where the games-list
-- query (old or new shape) lacks index coverage. DROP INDEX CONCURRENTLY can't run inside a
-- transaction (hence `-- no-transaction`) and must be the only statement in its migration.

DROP INDEX CONCURRENTLY IF EXISTS idx_games_matchmaking_completed_start;
