ALTER TABLE games ADD COLUMN selected_matchup text;
ALTER TABLE games ADD COLUMN assigned_matchup text;

CREATE INDEX idx_games_selected_matchup ON games (selected_matchup) WHERE selected_matchup IS NOT NULL;
CREATE INDEX idx_games_assigned_matchup ON games (assigned_matchup) WHERE assigned_matchup IS NOT NULL;

-- Backfill matchup columns from existing config/results JSONB data
CREATE OR REPLACE FUNCTION backfill_matchups() RETURNS void AS $$
DECLARE
  r RECORD;
  team_races text[];
  all_team_strings text[];
  team_str text;
  player_race text;
  player_id int;
  team jsonb;
  player jsonb;
  result_pair jsonb;
  teams_count int;
  team0_count int;
  selected text;
  assigned text;
  is_1v1_single_team boolean;
  has_computers boolean;
BEGIN
  FOR r IN SELECT id, config, results FROM games LOOP
    teams_count := jsonb_array_length(r.config->'teams');
    selected := NULL;
    assigned := NULL;
    is_1v1_single_team := false;

    has_computers := EXISTS (
      SELECT 1
      FROM jsonb_array_elements(r.config->'teams') AS t,
           jsonb_array_elements(t) AS p
      WHERE (p->>'isComputer')::boolean = true
    );

    -- Determine if we can compute matchups
    IF teams_count = 1 THEN
      team0_count := jsonb_array_length(r.config->'teams'->0);
      IF team0_count = 2 THEN
        -- 1v1 stored as single team of 2 - split into two teams
        is_1v1_single_team := true;
      ELSE
        -- Melee with >2 players, can't determine teams
        CONTINUE;
      END IF;
    END IF;

    -- Compute selected_matchup
    IF is_1v1_single_team THEN
      -- Split single team into two 1-player teams
      all_team_strings := ARRAY[
        (r.config->'teams'->0->0->>'race'),
        (r.config->'teams'->0->1->>'race')
      ];
      -- Sort the team strings
      SELECT array_agg(s ORDER BY s) INTO all_team_strings FROM unnest(all_team_strings) AS s;
      selected := array_to_string(all_team_strings, '-');
    ELSE
      -- Multiple teams: sort races within each team, collect team strings
      all_team_strings := ARRAY[]::text[];
      FOR i IN 0..(teams_count - 1) LOOP
        team := r.config->'teams'->i;
        team_races := ARRAY[]::text[];
        FOR j IN 0..(jsonb_array_length(team) - 1) LOOP
          team_races := array_append(team_races, team->j->>'race');
        END LOOP;
        -- Sort races within the team
        SELECT array_agg(s ORDER BY s) INTO team_races FROM unnest(team_races) AS s;
        team_str := array_to_string(team_races, '');
        all_team_strings := array_append(all_team_strings, team_str);
      END LOOP;
      -- Sort team strings lexicographically
      SELECT array_agg(s ORDER BY s) INTO all_team_strings FROM unnest(all_team_strings) AS s;
      selected := array_to_string(all_team_strings, '-');
    END IF;

    -- Compute assigned_matchup (only if results exist and no computer players)
    IF r.results IS NOT NULL AND NOT has_computers THEN
      IF is_1v1_single_team THEN
        -- For 1v1, look up each player's assigned race from results
        all_team_strings := ARRAY[]::text[];
        FOR k IN 0..1 LOOP
          player := r.config->'teams'->0->k;
          player_id := (player->>'id')::int;
          player_race := NULL;
          FOR result_pair IN SELECT jsonb_array_elements(r.results) LOOP
            IF (result_pair->0)::int = player_id THEN
              player_race := result_pair->1->>'race';
              EXIT;
            END IF;
          END LOOP;
          IF player_race IS NULL THEN
            -- Player not found in results, skip this game
            all_team_strings := NULL;
            EXIT;
          END IF;
          all_team_strings := array_append(all_team_strings, player_race);
        END LOOP;

        IF all_team_strings IS NOT NULL THEN
          SELECT array_agg(s ORDER BY s) INTO all_team_strings FROM unnest(all_team_strings) AS s;
          assigned := array_to_string(all_team_strings, '-');
        END IF;
      ELSE
        -- Multiple teams
        all_team_strings := ARRAY[]::text[];
        FOR i IN 0..(teams_count - 1) LOOP
          team := r.config->'teams'->i;
          team_races := ARRAY[]::text[];
          FOR j IN 0..(jsonb_array_length(team) - 1) LOOP
            player := team->j;
            player_id := (player->>'id')::int;
            player_race := NULL;
            FOR result_pair IN SELECT jsonb_array_elements(r.results) LOOP
              IF (result_pair->0)::int = player_id THEN
                player_race := result_pair->1->>'race';
                EXIT;
              END IF;
            END LOOP;
            IF player_race IS NULL THEN
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
          team_str := array_to_string(team_races, '');
          all_team_strings := array_append(all_team_strings, team_str);
        END LOOP;

        IF all_team_strings IS NOT NULL THEN
          SELECT array_agg(s ORDER BY s) INTO all_team_strings FROM unnest(all_team_strings) AS s;
          assigned := array_to_string(all_team_strings, '-');
        END IF;
      END IF;
    END IF;

    UPDATE games SET selected_matchup = selected, assigned_matchup = assigned WHERE id = r.id;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

SELECT backfill_matchups();
DROP FUNCTION backfill_matchups();
