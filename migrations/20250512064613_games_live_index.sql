-- Create an index that will contain (mainly) the currently live games that we query for the home
-- page, etc.
CREATE INDEX idx_games_null_length_recent_start
ON games (start_time DESC)
WHERE game_length IS NULL;
