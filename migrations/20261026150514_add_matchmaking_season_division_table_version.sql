-- Which version of the division bounds a season's divisions are placed with. A season keeps the
-- version it was played under, so later changes to the bounds don't move its divisions. Seasons
-- that had already started when this column was added were played under version 1.
ALTER TABLE matchmaking_seasons ADD COLUMN division_table_version SMALLINT NOT NULL DEFAULT 2;
UPDATE matchmaking_seasons SET division_table_version = 1 WHERE start_date <= now();
