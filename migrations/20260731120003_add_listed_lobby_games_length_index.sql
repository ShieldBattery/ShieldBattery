-- no-transaction

-- Companion to 20260731120002: the same listed-lobby partial index, but for the game_length sorts
-- (ShortestFirst/LongestFirst) of the Custom-filtered games list. See that migration for the
-- rationale.

CREATE INDEX CONCURRENTLY idx_games_lobby_listed_completed_length
ON games (game_length, start_time DESC, id DESC)
WHERE config->>'gameSource' = 'LOBBY'
  AND config->'gameSourceExtra'->>'visibility' = 'listed'
  AND results IS NOT NULL;
