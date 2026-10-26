-- A map of matchmaking type -> the rating offset applied to that type's division bounds for the
-- season. Computed once, when the season becomes the current one; NULL until then.
ALTER TABLE matchmaking_seasons ADD COLUMN division_rating_offsets JSONB;
