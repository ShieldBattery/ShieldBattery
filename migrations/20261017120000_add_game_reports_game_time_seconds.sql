-- How far into the game (in seconds of game time) a report was filed, for reports filed while the
-- game was being played. NULL for reports filed afterward.
ALTER TABLE game_reports
  ADD COLUMN game_time_seconds integer CHECK (game_time_seconds >= 0);
