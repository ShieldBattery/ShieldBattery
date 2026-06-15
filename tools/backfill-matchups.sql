-- Backfills games.selected_matchup / games.assigned_matchup from the historical config/results
-- JSONB. Run this AFTER the 20260212000000_add_matchup_columns migration has been applied and the
-- new application code has been deployed.
--
-- Why this isn't part of the migration: backfilling (potentially) rewrites every row in `games`,
-- and we don't want to hold a lock on that table for the whole duration. This processes the table
-- in id-range batches, committing after each batch so locks are released and normal traffic can
-- interleave between batches.
--
-- It is idempotent and safe to re-run: a row is only written when a freshly computed value actually
-- differs from what's stored. Running it again after the deploy has settled therefore doubles as a
-- cheap catch-up pass for any games that were created or reconciled by old code during the deploy
-- window (which would otherwise keep NULL matchups forever).
--
-- Usage (psql, and NOT wrapped in an explicit transaction, so the per-batch COMMITs can take
-- effect):
--   \i tools/backfill-matchups.sql               -- installs/updates the procedure
--   CALL backfill_matchups(dry_run => true);      -- report how many rows *would* change, no writes
--   CALL backfill_matchups();                     -- run it for real (5000-row batches)
--   CALL backfill_matchups(batch_size => 20000);  -- larger batches
--
-- The procedure is left installed afterwards. Clean it up when you're done with:
--   DROP PROCEDURE backfill_matchups(int, boolean);

CREATE OR REPLACE PROCEDURE backfill_matchups(batch_size int DEFAULT 5000, dry_run boolean DEFAULT false)
LANGUAGE plpgsql AS $$
DECLARE
  r RECORD;
  last_id uuid := '00000000-0000-0000-0000-000000000000';
  batch_last_id uuid;
  non_empty_teams jsonb[];
  teams_for_matchup jsonb[];
  teams_count int;
  is_1v1_single_team boolean;
  has_computers boolean;
  selected text;
  assigned text;
  all_team_strings text[];
  team_races text[];
  player_race text;
  player_id int;
  team jsonb;
  player jsonb;
  result_pair jsonb;
  processed bigint := 0;
  changed bigint := 0;
BEGIN
  LOOP
    batch_last_id := NULL;

    FOR r IN
      SELECT id, config, results, disputable, selected_matchup, assigned_matchup
      FROM games
      WHERE id > last_id
      ORDER BY id
      LIMIT batch_size
    LOOP
      batch_last_id := r.id;
      processed := processed + 1;

      selected := NULL;
      assigned := NULL;
      is_1v1_single_team := false;

      -- Drop empty teams (e.g. observer teams in melee lobbies serialize as []) before working out
      -- the real layout. This mirrors getTeamsFromConfig() in common/games/matchups.ts.
      non_empty_teams := ARRAY(
        SELECT t
        FROM jsonb_array_elements(r.config->'teams') AS t
        WHERE jsonb_array_length(t) > 0
      );
      teams_count := coalesce(array_length(non_empty_teams, 1), 0);

      has_computers := EXISTS (
        SELECT 1
        FROM unnest(non_empty_teams) AS t,
             jsonb_array_elements(t) AS p
        WHERE (p->>'isComputer')::boolean = true
      );

      IF teams_count = 1 THEN
        IF jsonb_array_length(non_empty_teams[1]) = 2 THEN
          -- 1v1 stored as a single team of 2 - split into two single-player teams
          is_1v1_single_team := true;
        ELSE
          -- Melee with != 2 players, can't determine teams; leave matchups NULL
          teams_count := 0;
        END IF;
      END IF;

      IF teams_count >= 2 OR is_1v1_single_team THEN
        IF is_1v1_single_team THEN
          teams_for_matchup := ARRAY[
            jsonb_build_array(non_empty_teams[1]->0),
            jsonb_build_array(non_empty_teams[1]->1)
          ];
        ELSE
          teams_for_matchup := non_empty_teams;
        END IF;

        -- selected_matchup: from each player's configured race
        all_team_strings := ARRAY[]::text[];
        FOREACH team IN ARRAY teams_for_matchup LOOP
          team_races := ARRAY[]::text[];
          FOR j IN 0..(jsonb_array_length(team) - 1) LOOP
            team_races := array_append(team_races, team->j->>'race');
          END LOOP;
          SELECT array_agg(s ORDER BY s) INTO team_races FROM unnest(team_races) AS s;
          all_team_strings := array_append(all_team_strings, array_to_string(team_races, ''));
        END LOOP;
        SELECT array_agg(s ORDER BY s) INTO all_team_strings FROM unnest(all_team_strings) AS s;
        selected := array_to_string(all_team_strings, '-');

        -- assigned_matchup: from each player's assigned (result) race, only when results exist and
        -- there are no computer players (computers aren't included in our results). Some legacy rows
        -- store results as a non-array (e.g. an empty `{}` object), which we treat as "no results".
        -- Disputed games are skipped too: their results (and thus assigned races) are unreliable,
        -- and a player missing from the reports gets a fabricated 'p' race baked into the stored
        -- results. This matches the live reconciliation path, which leaves assigned_matchup NULL for
        -- disputed games.
        IF jsonb_typeof(r.results) = 'array' AND NOT has_computers AND NOT r.disputable THEN
          all_team_strings := ARRAY[]::text[];
          FOREACH team IN ARRAY teams_for_matchup LOOP
            team_races := ARRAY[]::text[];
            FOR j IN 0..(jsonb_array_length(team) - 1) LOOP
              player := team->j;
              player_id := (player->>'id')::int;
              player_race := NULL;
              FOR result_pair IN SELECT jsonb_array_elements(r.results) LOOP
                IF (result_pair->>0)::int = player_id THEN
                  player_race := result_pair->1->>'race';
                  EXIT;
                END IF;
              END LOOP;
              IF player_race IS NULL THEN
                -- Player missing from results, can't compute an assigned matchup for this game
                team_races := NULL;
                EXIT;
              END IF;
              team_races := array_append(team_races, player_race);
            END LOOP;

            IF team_races IS NULL THEN
              all_team_strings := NULL;
              EXIT;
            END IF;

            SELECT array_agg(s ORDER BY s) INTO team_races FROM unnest(team_races) AS s;
            all_team_strings := array_append(all_team_strings, array_to_string(team_races, ''));
          END LOOP;

          IF all_team_strings IS NOT NULL THEN
            SELECT array_agg(s ORDER BY s) INTO all_team_strings FROM unnest(all_team_strings) AS s;
            assigned := array_to_string(all_team_strings, '-');
          END IF;
        END IF;
      END IF;

      IF r.selected_matchup IS DISTINCT FROM selected
         OR r.assigned_matchup IS DISTINCT FROM assigned THEN
        changed := changed + 1;
        IF NOT dry_run THEN
          UPDATE games
          SET selected_matchup = selected, assigned_matchup = assigned
          WHERE id = r.id;
        END IF;
      END IF;
    END LOOP;

    -- No rows came back, we've reached the end of the table.
    EXIT WHEN batch_last_id IS NULL;

    last_id := batch_last_id;
    IF NOT dry_run THEN
      COMMIT;
      RAISE NOTICE 'backfill_matchups: processed % games (% changed so far)', processed, changed;
    END IF;
  END LOOP;

  IF dry_run THEN
    RAISE NOTICE 'backfill_matchups dry run: % of % games would change', changed, processed;
  ELSE
    RAISE NOTICE 'backfill_matchups: done, updated % of % games', changed, processed;
  END IF;
END;
$$;
