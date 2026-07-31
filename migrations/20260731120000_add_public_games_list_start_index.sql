-- no-transaction

-- Index to serve the public global games list (server/lib/games/game-models.ts `getGames`) in its
-- default "all sources" mode, which queries completed matchmaking games OR completed public
-- (listed-visibility) lobby games ordered by recency. The existing
-- `idx_games_matchmaking_completed_start` (20260615120000) is partial on the matchmaking-only
-- predicate, so the planner can't use it once the WHERE clause is that OR -- without this index the
-- default page view of the unauthenticated games endpoint falls back to a seq scan + top-N sort
-- over the entire `games` table, which is exactly what that migration was added to prevent.
--
-- This index also serves the Ranked (matchmaking-only) filter: that predicate implies this one, and
-- listed lobby games are a small enough fraction of the table that the ordered walk skips few rows.
-- The matchmaking-only pair from 20260615120000/20260615120001 therefore becomes redundant and is
-- dropped in 20260731120004/20260731120005. The Custom (listed-lobby-only) filter gets its own
-- narrower pair in 20260731120002/20260731120003, where the fraction argument runs the other way.
--
-- This builds CONCURRENTLY (hence the `-- no-transaction` directive above, since CREATE INDEX
-- CONCURRENTLY can't run inside a transaction), and is its own migration because sqlx sends a
-- migration's body to Postgres as a single multi-statement simple query, which runs in an implicit
-- transaction block -- so each CREATE INDEX CONCURRENTLY must be the only statement in its
-- migration. The `id` tiebreaker matches the ORDER BY in `getGames` so the index can fully satisfy
-- the ordering and keep pagination deterministic.

CREATE INDEX CONCURRENTLY idx_games_public_completed_start
ON games (start_time DESC, id DESC)
WHERE (config->>'gameSource' = 'MATCHMAKING'
       OR (config->>'gameSource' = 'LOBBY'
           AND config->'gameSourceExtra'->>'visibility' = 'listed'))
  AND results IS NOT NULL;
