-- Adds the matchup columns used for filtering games by format/matchup. These are populated going
-- forward by the application code (selected_matchup at registration, assigned_matchup at result
-- reconciliation).
--
-- NOTE: This migration intentionally only does the (instant) DDL. Adding a nullable column is a
-- metadata-only change, and the partial indexes are empty at creation time (every row is NULL), so
-- they build instantly and nothing here holds a long lock on `games`. Backfilling the existing rows
-- is done separately and out-of-band via tools/backfill-matchups.sql so we don't lock the table for
-- the (potentially very long) duration of rewriting every row.

ALTER TABLE games ADD COLUMN selected_matchup text;
ALTER TABLE games ADD COLUMN assigned_matchup text;

-- Only assigned_matchup gets an index: matchup filtering is an equality lookup
-- (`assigned_matchup = ANY(...)`) which a btree can serve. selected_matchup is only used for format
-- filtering, which is a regex on team sizes that a plain btree can't serve, so an index on it would
-- be pure write overhead. If/when a global games page needs to filter by format at scale, that
-- should get a purpose-built index (e.g. an expression index on the team sizes or a generated
-- column) rather than this column's raw value.
CREATE INDEX idx_games_assigned_matchup ON games (assigned_matchup) WHERE assigned_matchup IS NOT NULL;
