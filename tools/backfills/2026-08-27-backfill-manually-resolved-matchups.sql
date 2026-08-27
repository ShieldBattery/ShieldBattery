-- Backfills games.assigned_matchup for manually resolved games, from their config plus their
-- players' stored reports. Run this AFTER the 20260212000000_add_matchup_columns and
-- 20260825120000_add_manual_game_resolution migrations have been applied and the new application
-- code has been deployed.
--
-- Why these games need their own pass: hand-resolving a game clears `disputable` without touching
-- the races the disputed reconciliation left behind, and those races can be inventions — a player
-- who appeared in no report at all is stored as 'p'. The stored results are therefore no evidence
-- here, which puts these games outside what 2026-08-09-backfill-matchups.sql (which reads the
-- stored results of every non-disputable game, and like every script here was run once and is
-- never edited) can compute. Instead, the assigned races are rebuilt from the two sources that
-- stand on their own: a player who picked a specific race settles their own race, a random
-- player's race is known only when at least one stored report mentions them and every mention
-- agrees, and a game where any player's race is unknown gets no assigned matchup at all. Those
-- are the same rules resolveGameManually applies, so where the resolution already derived a
-- matchup the recompute matches what's stored and writes nothing.
--
-- selected_matchup is left alone: manual resolution never touches a game's config, so it was
-- already computed at game creation or by the earlier backfill.
--
-- It is idempotent and safe to re-run: a row is only written when the freshly computed value
-- actually differs from what's stored — including writing NULL over a stored matchup the trusted
-- sources can't reproduce.
--
-- Like the other scripts here it processes the table in id-range batches, committing after each
-- batch so locks are released and normal traffic can interleave; manually resolved games are rare
-- enough that this will typically be a single batch.
--
-- Usage (psql, and NOT wrapped in an explicit transaction, so the per-batch COMMITs can take
-- effect):
--   \i tools/backfills/2026-08-27-backfill-manually-resolved-matchups.sql
--   CALL backfill_manually_resolved_matchups(dry_run => true);      -- report, no writes
--   CALL backfill_manually_resolved_matchups();                     -- run it for real
--   CALL backfill_manually_resolved_matchups(batch_size => 20000);  -- larger batches
--
-- The procedure is left installed afterwards. Clean it up when you're done with:
--   DROP PROCEDURE backfill_manually_resolved_matchups(int, boolean);

CREATE OR REPLACE PROCEDURE backfill_manually_resolved_matchups(
  batch_size int DEFAULT 5000, dry_run boolean DEFAULT false)
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
  assigned text;
  all_team_strings text[];
  team_races text[];
  player_race text;
  team jsonb;
  player jsonb;
  agreed_races jsonb;
  processed bigint := 0;
  changed bigint := 0;
BEGIN
  LOOP
    batch_last_id := NULL;

    FOR r IN
      SELECT id, config, assigned_matchup
      FROM games
      WHERE manually_resolved_at IS NOT NULL AND id > last_id
      ORDER BY id
      LIMIT batch_size
    LOOP
      batch_last_id := r.id;
      processed := processed + 1;

      assigned := NULL;
      is_1v1_single_team := false;

      -- Drop empty teams (e.g. observer teams in melee lobbies serialize as []) before working out
      -- the real layout. This mirrors getTeamsFromConfig() in common/games/matchups.ts.
      --
      -- The type guards are not paranoia: `games` is long-lived and `config` is schemaless, so a
      -- historical row whose `teams` is missing, null, an object or a scalar is entirely possible.
      -- `jsonb_array_elements` raises on those rather than returning nothing, which would abort the
      -- whole backfill part-way through -- committed batches kept, the rest never processed. Rows
      -- with an unusable shape are skipped, leaving their matchup columns as they were.
      IF jsonb_typeof(r.config->'teams') <> 'array' THEN
        CONTINUE;
      END IF;

      non_empty_teams := ARRAY(
        SELECT t
        FROM jsonb_array_elements(r.config->'teams') AS t
        WHERE jsonb_typeof(t) = 'array' AND jsonb_array_length(t) > 0
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
          -- Melee with != 2 players, can't determine teams; leave the matchup NULL
          teams_count := 0;
        END IF;
      END IF;

      -- Games with computer players never get an assigned matchup, since computers aren't included
      -- in our results at all.
      IF (teams_count >= 2 OR is_1v1_single_team) AND NOT has_computers THEN
        IF is_1v1_single_team THEN
          teams_for_matchup := ARRAY[
            jsonb_build_array(non_empty_teams[1]->0),
            jsonb_build_array(non_empty_teams[1]->1)
          ];
        ELSE
          teams_for_matchup := non_empty_teams;
        END IF;

        BEGIN
          -- The race the reports agree on for each user, dropped where they disagree. A row's
          -- `reported_results` is either a raw (v2) report, listing one entry per BW player
          -- (`userId` null for computers), or a legacy digested one, whose `playerResults`
          -- pairs a user id with that user's verdict; the presence of `version` tells the two
          -- apart. A user can be named more than once within a single report, so every mention
          -- is aggregated rather than picked from.
          --
          -- `reported_results` is schemaless jsonb on a long-lived table, so each array is
          -- forced through a CASE yielding [] for a row of the wrong shape:
          -- jsonb_array_elements raises on a non-array, and it expands rows before the WHERE
          -- clause gets to filter them out.
          SELECT coalesce(jsonb_object_agg(user_id, races[1]), '{}'::jsonb)
            INTO agreed_races
          FROM (
            SELECT user_id, array_agg(DISTINCT race) AS races
            FROM (
              SELECT (p->>'userId')::int AS user_id, p->>'race' AS race
              FROM games_users gu,
                   jsonb_array_elements(
                     CASE WHEN jsonb_typeof(gu.reported_results->'players') = 'array'
                       THEN gu.reported_results->'players'
                       ELSE '[]'::jsonb
                     END
                   ) AS p
              WHERE gu.game_id = r.id
                AND gu.reported_results IS NOT NULL
                AND jsonb_exists(gu.reported_results, 'version')
                AND jsonb_typeof(p) = 'object'
                AND jsonb_typeof(p->'userId') = 'number'
                AND p->>'race' IN ('p', 't', 'z')
              UNION ALL
              SELECT (pair->>0)::int AS user_id, pair->1->>'race' AS race
              FROM games_users gu,
                   jsonb_array_elements(
                     CASE WHEN jsonb_typeof(gu.reported_results->'playerResults') = 'array'
                       THEN gu.reported_results->'playerResults'
                       ELSE '[]'::jsonb
                     END
                   ) AS pair
              WHERE gu.game_id = r.id
                AND gu.reported_results IS NOT NULL
                AND NOT jsonb_exists(gu.reported_results, 'version')
                AND jsonb_typeof(pair) = 'array'
                AND jsonb_typeof(pair->0) = 'number'
                AND pair->1->>'race' IN ('p', 't', 'z')
            ) AS mentions
            GROUP BY user_id
          ) AS per_user
          WHERE array_length(races, 1) = 1;

          all_team_strings := ARRAY[]::text[];
          FOREACH team IN ARRAY teams_for_matchup LOOP
            team_races := ARRAY[]::text[];
            FOR j IN 0..(jsonb_array_length(team) - 1) LOOP
              player := team->j;
              player_race := player->>'race';
              IF player_race = 'r' THEN
                player_race := agreed_races->>(player->>'id');
              ELSIF player_race NOT IN ('p', 't', 'z') THEN
                -- A config race that isn't a race settles nothing
                player_race := NULL;
              END IF;

              IF player_race IS NULL THEN
                -- This player's race can't be established, so the game gets no matchup
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
            SELECT array_agg(s ORDER BY s) INTO all_team_strings
            FROM unnest(all_team_strings) AS s;
            assigned := array_to_string(all_team_strings, '-');
          END IF;
        EXCEPTION WHEN OTHERS THEN
          -- A report or config shape we can't read must not abort the whole run, and it says
          -- nothing about whether the stored matchup is right. Keep what's there and move on.
          assigned := r.assigned_matchup;
        END;
      END IF;

      IF r.assigned_matchup IS DISTINCT FROM assigned THEN
        changed := changed + 1;
        IF NOT dry_run THEN
          UPDATE games
          SET assigned_matchup = assigned
          WHERE id = r.id;
        END IF;
      END IF;
    END LOOP;

    -- No rows came back, we've reached the end of the table.
    EXIT WHEN batch_last_id IS NULL;

    last_id := batch_last_id;
    IF NOT dry_run THEN
      COMMIT;
      RAISE NOTICE 'backfill_manually_resolved_matchups: processed % games (% changed so far)',
        processed, changed;
    END IF;
  END LOOP;

  IF dry_run THEN
    RAISE NOTICE 'backfill_manually_resolved_matchups dry run: % of % games would change',
      changed, processed;
  ELSE
    RAISE NOTICE 'backfill_manually_resolved_matchups: done, updated % of % games',
      changed, processed;
  END IF;
END;
$$;
