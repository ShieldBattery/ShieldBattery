-- no-transaction

-- Companion to 20260731120004: drops the game_length variant of the matchmaking-only games-list
-- index, superseded by `idx_games_public_completed_length` (20260731120001) the same way. See
-- 20260731120004 for the rationale.

DROP INDEX CONCURRENTLY IF EXISTS idx_games_matchmaking_completed_length;
