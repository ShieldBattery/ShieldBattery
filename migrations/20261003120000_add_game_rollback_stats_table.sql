-- Adds a table holding each rollback client's statistics for a game, submitted once by the game
-- client when the game ends, so rollback behavior can be compared across games with plain SQL.
--
-- The commonly queried values are broken out into columns (the percentiles derived by the server
-- from the histograms, nearest rank, NULL when the histogram has no ticks); `details` holds the whole
-- submitted stats object, so fields that newer clients add are kept without a migration.
--
-- PRIMARY KEY (game_id, user_id) with INSERT ... ON CONFLICT DO NOTHING makes the first submission
-- for a player win; a retried submission is a no-op.

CREATE TABLE game_rollback_stats (
  game_id UUID NOT NULL,
  user_id INTEGER NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ticks INTEGER NOT NULL,
  through_turn INTEGER NOT NULL,
  rollback_target INTEGER NOT NULL,
  prediction_limit INTEGER NOT NULL,
  capped_ticks INTEGER NOT NULL,
  rollbacks INTEGER NOT NULL,
  resimulated_frames INTEGER NOT NULL,
  deepest_rollback INTEGER NOT NULL,
  mispredicted_turns INTEGER NOT NULL,
  slow_ticks INTEGER NOT NULL,
  worst_tick_us BIGINT NOT NULL,
  rollback_p50 SMALLINT NULL,
  rollback_p90 SMALLINT NULL,
  pipe_p50 SMALLINT NULL,
  pipe_p90 SMALLINT NULL,
  rollback_histogram INTEGER[] NOT NULL,
  pipe_histogram INTEGER[] NOT NULL,
  details JSONB NOT NULL,
  PRIMARY KEY (game_id, user_id)
);

CREATE INDEX game_rollback_stats_submitted_at_index ON game_rollback_stats (submitted_at);
