ALTER TABLE matchmaking_match_formations
  ADD COLUMN rating_variance_multiplier real NOT NULL DEFAULT 1;
