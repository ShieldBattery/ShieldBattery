-- Backfills games_users.team from the historical config JSONB. Run this AFTER the
-- 20260803130000_add_games_users_team migration has been applied and the new application code has
-- been deployed.
--
-- Why this isn't part of the migration: backfilling touches every row in `games_users`, and we
-- don't want to hold a lock on that table for the whole duration. This processes the games in
-- id-range batches, committing after each batch so locks are released and normal traffic can
-- interleave between batches.
--
-- It is idempotent and safe to re-run: a row is only written when the computed team actually
-- differs from what's stored. Running it again after the deploy has settled therefore doubles as a
-- cheap catch-up pass for any games registered by old code during the deploy window (which would
-- otherwise keep NULL teams forever).
--
-- The team derivation deliberately mirrors getTeamsFromConfig() in common/games/matchups.ts, the
-- same way 2026-08-09-backfill-matchups.sql does -- the two columns describe the same division of the same
-- game, so they have to be computed the same way or a row's team and its game's matchup string
-- will disagree.
--
-- Games with no determinable teams (Melee with more than two players) are skipped, leaving their
-- rows NULL. NULL means "unknown", never team zero.
--
-- Usage (psql, and NOT wrapped in an explicit transaction, so the per-batch COMMITs can take
-- effect):
--   \i tools/backfills/2026-08-09-backfill-teams.sql      -- installs/updates the procedure
--   CALL backfill_teams(dry_run => true);      -- report how many rows *would* change, no writes
--   CALL backfill_teams();                     -- run it for real (5000-game batches)
--   CALL backfill_teams(batch_size => 20000);  -- larger batches
--
-- The procedure is left installed afterwards. Clean it up when you're done with:
--   DROP PROCEDURE backfill_teams(int, boolean);

CREATE OR REPLACE PROCEDURE backfill_teams(batch_size int DEFAULT 5000, dry_run boolean DEFAULT false)
LANGUAGE plpgsql AS $$
DECLARE
  r RECORD;
  last_id uuid := '00000000-0000-0000-0000-000000000000';
  batch_last_id uuid;
  non_empty_teams jsonb[];
  teams_for_matchup jsonb[];
  teams_count int;
  is_1v1_single_team boolean;
  team jsonb;
  player_ids int[];
  team_indexes smallint[];
  team_index smallint;
  affected bigint;
  would_change bigint;
  processed bigint := 0;
  changed bigint := 0;
  undeterminable bigint := 0;
BEGIN
  LOOP
    batch_last_id := NULL;

    FOR r IN
      SELECT id, config
      FROM games
      WHERE id > last_id
      ORDER BY id
      LIMIT batch_size
    LOOP
      batch_last_id := r.id;
      processed := processed + 1;

      is_1v1_single_team := false;

      -- Drop empty teams (e.g. observer teams in melee lobbies serialize as []) before working out
      -- the real layout. This mirrors getTeamsFromConfig() in common/games/matchups.ts.
      --
      -- The type guards are not paranoia: `games` is long-lived and `config` is schemaless, so a
      -- historical row whose `teams` is missing, null, an object or a scalar is entirely possible.
      -- `jsonb_array_elements` raises on those rather than returning nothing, which would abort the
      -- whole backfill part-way through -- committed batches kept, the rest never processed. Each
      -- unusable shape is counted and skipped instead.
      IF jsonb_typeof(r.config->'teams') <> 'array' THEN
        undeterminable := undeterminable + 1;
        CONTINUE;
      END IF;

      non_empty_teams := ARRAY(
        SELECT t
        FROM jsonb_array_elements(r.config->'teams') AS t
        WHERE jsonb_typeof(t) = 'array' AND jsonb_array_length(t) > 0
      );
      teams_count := coalesce(array_length(non_empty_teams, 1), 0);

      IF teams_count = 1 THEN
        IF jsonb_array_length(non_empty_teams[1]) = 2 THEN
          -- 1v1 stored as a single team of 2 - split into two single-player teams
          is_1v1_single_team := true;
        ELSE
          -- Melee with != 2 players, can't determine teams; leave team NULL
          teams_count := 0;
        END IF;
      END IF;

      IF teams_count < 2 AND NOT is_1v1_single_team THEN
        undeterminable := undeterminable + 1;
        CONTINUE;
      END IF;

      IF is_1v1_single_team THEN
        teams_for_matchup := ARRAY[
          jsonb_build_array(non_empty_teams[1]->0),
          jsonb_build_array(non_empty_teams[1]->1)
        ];
      ELSE
        teams_for_matchup := non_empty_teams;
      END IF;

      -- Flatten to parallel (user_id, team) arrays so the whole game is one statement rather than
      -- one per player. Computer players are included here and simply match no row -- they have no
      -- games_users entry -- which keeps the team indexes aligned with the config's teams rather
      -- than with the subset of players that got rows.
      player_ids := ARRAY[]::int[];
      team_indexes := ARRAY[]::smallint[];
      team_index := 0;
      FOREACH team IN ARRAY teams_for_matchup LOOP
        FOR j IN 0..(jsonb_array_length(team) - 1) LOOP
          player_ids := array_append(player_ids, (team->j->>'id')::int);
          team_indexes := array_append(team_indexes, team_index);
        END LOOP;
        team_index := team_index + 1;
      END LOOP;

      IF dry_run THEN
        SELECT count(*)
        INTO would_change
        FROM games_users gu
        JOIN unnest(player_ids, team_indexes) AS v(user_id, team) ON gu.user_id = v.user_id
        WHERE gu.game_id = r.id AND gu.team IS DISTINCT FROM v.team;

        IF would_change > 0 THEN
          changed := changed + 1;
        END IF;
      ELSE
        UPDATE games_users gu
        SET team = v.team
        FROM unnest(player_ids, team_indexes) AS v(user_id, team)
        WHERE gu.game_id = r.id
          AND gu.user_id = v.user_id
          AND gu.team IS DISTINCT FROM v.team;

        GET DIAGNOSTICS affected = ROW_COUNT;
        IF affected > 0 THEN
          changed := changed + 1;
        END IF;
      END IF;
    END LOOP;

    -- No rows came back, we've reached the end of the table.
    EXIT WHEN batch_last_id IS NULL;

    last_id := batch_last_id;
    IF NOT dry_run THEN
      COMMIT;
      RAISE NOTICE 'backfill_teams: processed % games (% changed so far)', processed, changed;
    END IF;
  END LOOP;

  -- `undeterminable` is the number worth reading before running this for real: those games have no
  -- team layout to recover, so their rows stay NULL however many times this is run. A large count
  -- means the historical data is shaped differently than expected, not that the backfill failed.
  IF dry_run THEN
    RAISE NOTICE 'backfill_teams dry run: % of % games would change (% have no determinable teams)',
      changed, processed, undeterminable;
  ELSE
    RAISE NOTICE 'backfill_teams: done, updated % of % games (% have no determinable teams)',
      changed, processed, undeterminable;
  END IF;
END;
$$;
