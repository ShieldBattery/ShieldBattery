-- Which version of the division bounds a season's divisions are placed with. A season keeps the
-- version it was played under, so later changes to the bounds don't move its divisions. New seasons
-- get their version from the server when they're created.
ALTER TABLE matchmaking_seasons ADD COLUMN division_table_version SMALLINT NOT NULL DEFAULT 1;
