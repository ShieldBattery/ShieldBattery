-- no-transaction

-- Companion to 20260615120000: the same partial-index strategy, but for the game_length sorts
-- (ShortestFirst/LongestFirst) of the global games list. See that migration for the full rationale.
--
-- This is its own migration (rather than a second statement in 20260615120000) because sqlx sends a
-- migration's body to Postgres as a single multi-statement simple query, which runs in an implicit
-- transaction block that CREATE INDEX CONCURRENTLY can't run inside.

CREATE INDEX CONCURRENTLY idx_games_matchmaking_completed_length
ON games (game_length, start_time DESC, id DESC)
WHERE config->>'gameSource' = 'MATCHMAKING' AND results IS NOT NULL;
