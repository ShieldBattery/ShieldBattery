-- no-transaction

-- Index to serve lookups of one user's most recent games (server/lib/games/game-models.ts
-- `getRecentMatchmakingOpponents`, which runs every time a player queues for matchmaking, and
-- `getRecentGamesForUser`). The primary key (user_id, game_id) finds a user's rows but not in time
-- order, so without this index those queries read every game the user has ever played to find the
-- handful that are recent.
--
-- This builds CONCURRENTLY (hence the `-- no-transaction` directive above, since CREATE INDEX
-- CONCURRENTLY can't run inside a transaction): the table is large, and a regular CREATE INDEX
-- would hold a lock that blocks game registration and result writes for the entire build.

CREATE INDEX CONCURRENTLY games_users_user_id_start_time_index
ON games_users (user_id, start_time DESC);
