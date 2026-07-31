-- no-transaction

-- Serves the global games list's Custom filter (completed listed-visibility lobby games only,
-- ordered by recency). The combined-predicate index from 20260731120000 could technically serve
-- this too, but listed lobby games are a small fraction of the table, so an ordered walk of that
-- index would skip over long runs of matchmaking rows to fill a page; this index keeps the Custom
-- filter's top-N scan touching only the rows it returns. Mirrors the matchmaking-only pair from
-- 20260615120000/20260615120001.
--
-- Builds CONCURRENTLY (hence `-- no-transaction`), one statement per migration because sqlx runs a
-- migration body as a single implicit-transaction query that CREATE INDEX CONCURRENTLY can't run
-- inside.

CREATE INDEX CONCURRENTLY idx_games_lobby_listed_completed_start
ON games (start_time DESC, id DESC)
WHERE config->>'gameSource' = 'LOBBY'
  AND config->'gameSourceExtra'->>'visibility' = 'listed'
  AND results IS NOT NULL;
