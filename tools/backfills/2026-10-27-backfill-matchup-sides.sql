-- Backfills matchup_sides for every game with matchmaking rating changes. Run this AFTER the
-- 20261027184142_add_matchup_sides migration has been applied and the application code that calls
-- refresh_matchup_sides has been deployed, so no game reconciled in between is missed.
--
-- Rows are produced by the refresh_matchup_sides function the migration installs, the same one the
-- server calls when it applies a game's results, so backfilled and newly written rows can't
-- disagree about what a side is. That function rewrites a game's rows from scratch, which makes
-- this idempotent and safe to re-run for as long as the server keeps calling it on every result
-- change.
--
-- Games are visited in game_id order through matchmaking_rating_changes' game_id index, committing
-- after each batch so locks are released and normal traffic can interleave.
--
-- Usage (psql, and NOT wrapped in an explicit transaction, so the per-batch COMMITs can take
-- effect):
--   \i tools/backfills/2026-10-27-backfill-matchup-sides.sql
--   CALL backfill_matchup_sides(dry_run => true);      -- report, no writes
--   CALL backfill_matchup_sides();                     -- run it for real
--   CALL backfill_matchup_sides(batch_size => 20000);  -- larger batches
--
-- The procedure is left installed afterwards. Clean it up when you're done with:
--   DROP PROCEDURE backfill_matchup_sides(int, boolean);

CREATE OR REPLACE PROCEDURE backfill_matchup_sides(
  batch_size int DEFAULT 5000, dry_run boolean DEFAULT false)
LANGUAGE plpgsql AS $$
DECLARE
  last_id uuid := '00000000-0000-0000-0000-000000000000';
  batch_ids uuid[];
  batch_sides bigint;
  batch_games bigint;
  processed bigint := 0;
  sides bigint := 0;
  with_sides bigint := 0;
BEGIN
  LOOP
    SELECT array_agg(game_id ORDER BY game_id)
    INTO batch_ids
    FROM (
      SELECT DISTINCT game_id
      FROM matchmaking_rating_changes
      WHERE game_id > last_id
      ORDER BY game_id
      LIMIT batch_size
    ) b;
    -- No rows came back, we've reached the end of the table.
    EXIT WHEN batch_ids IS NULL;

    PERFORM refresh_matchup_sides(batch_ids);
    SELECT count(*), count(DISTINCT game_id)
    INTO batch_sides, batch_games
    FROM matchup_sides
    WHERE game_id = ANY(batch_ids);

    processed := processed + cardinality(batch_ids);
    sides := sides + batch_sides;
    with_sides := with_sides + batch_games;
    last_id := batch_ids[cardinality(batch_ids)];

    -- A dry run computes each batch exactly as a real run would, then discards it.
    IF dry_run THEN
      ROLLBACK;
    ELSE
      COMMIT;
      RAISE NOTICE 'backfill_matchup_sides: processed % games (% sides so far)', processed, sides;
    END IF;
  END LOOP;
  -- Games without sides are ones refresh_matchup_sides can't read as two complete teams (no team
  -- layout, or races never assigned). A large share of them means the historical data is shaped
  -- differently than expected, not that the backfill failed: they're left out of the matchup
  -- matrices by design.
  IF dry_run THEN
    RAISE NOTICE 'backfill_matchup_sides dry run: % of % games would get sides (% sides)',
      with_sides, processed, sides;
  ELSE
    RAISE NOTICE 'backfill_matchup_sides: done, % of % games have sides (% sides)',
      with_sides, processed, sides;
  END IF;
END;
$$;
