-- no-transaction
CREATE INDEX CONCURRENTLY IF NOT EXISTS games_map_id_start_time_index
  ON games (map_id, start_time DESC);
