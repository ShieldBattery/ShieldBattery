-- no-transaction

-- Bound recent-session queries without blocking game creation or result writes during the build.
CREATE INDEX CONCURRENTLY games_collection_window_index ON games (start_time)
  WHERE netcode_v2_session IS NOT NULL AND canceled_at IS NULL;
