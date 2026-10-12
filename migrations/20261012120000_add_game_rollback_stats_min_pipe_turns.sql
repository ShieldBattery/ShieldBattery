-- Records the fewest of their own turns each rollback client's settings had it keep in flight: 2
-- when the player chose to match TR24 Low's input delay, 1 otherwise.
--
-- Nullable: clients that predate the setting don't report it.

ALTER TABLE game_rollback_stats
  ADD COLUMN min_pipe_turns INTEGER;
