-- One row per side of a rated matchmaking game: the races that side played, the races it played
-- against, and whether it won. This is what the profile's matchup matrices read, both a single
-- player's (by joining through their `games_users` row) and the ladder-wide one (by grouping the
-- whole mode).
--
-- `games.assigned_matchup` can't serve here: `computeMatchupString` sorts races within each team and
-- then sorts the teams, so the string doesn't say which side a given player was on (in `pt-pz` a
-- Protoss player could be on either half). The sides are rebuilt from `games_users.team` instead,
-- once, when a game's results are applied, so that readers only ever group rows.
--
-- Rows are written by `refresh_matchup_sides`, which the server calls inside the transaction that
-- applies a game's results, and which tools/backfills/2026-10-27-backfill-matchup-sides.sql calls
-- for historical games.
CREATE TABLE matchup_sides (
  game_id uuid NOT NULL REFERENCES games (id) ON DELETE CASCADE,
  -- `games_users.team` of the players on this side.
  team smallint NOT NULL,
  matchmaking_type matchmaking_type NOT NULL,
  -- The season the game's rating changes were applied in, matching how the rating history assigns
  -- them.
  season_id integer NOT NULL REFERENCES matchmaking_seasons (id) ON DELETE CASCADE,
  map_id uuid NOT NULL,
  -- This side's assigned races in TPZ order, e.g. `tp`. Who played which race isn't kept: a side is
  -- identified by its composition alone.
  races text NOT NULL,
  -- The opposing side's races, same encoding.
  opponent_races text NOT NULL,
  -- Mean of the rating every rated participant brought into the game (`rating - rating_change`),
  -- over both sides. Stored rather than bucketed so readers can choose their own rating bands.
  mean_rating real NOT NULL,
  won boolean NOT NULL,
  PRIMARY KEY (game_id, team)
);

CREATE INDEX matchup_sides_matchmaking_type_index ON matchup_sides (matchmaking_type);

-- Rewrites the `matchup_sides` rows of the given games from their current `games_users` and
-- `matchmaking_rating_changes` rows. Games that can't be read as two sides end up with no rows, so
-- calling this after a game's results change (including to disputed) always leaves it correct.
--
-- A game is written only when every player has both a team and an assigned race, and there are
-- exactly two teams of the same size. Registration writes every player's `games_users` row in one
-- transaction, so this is a complete roster check: a NULL team (Melee with more than two players,
-- or a row from before the column existed) or a NULL race (results never applied) drops the game
-- rather than shrinking a side.
--
-- A side gets a row only if at least one of its players has a rating change, since that's where
-- its outcome comes from; matchmaking applies a change to every participant, so in practice both
-- sides always have one. A side's players share an outcome, so `bool_and` only picks the value.
CREATE FUNCTION refresh_matchup_sides(game_ids uuid[]) RETURNS void
LANGUAGE sql AS $$
  DELETE FROM matchup_sides WHERE game_id = ANY(game_ids);

  WITH roster AS (
    SELECT
      gu.game_id,
      gu.team,
      gu.assigned_race,
      mrc.matchmaking_type,
      mrc.change_date,
      mrc.outcome,
      mrc.rating - mrc.rating_change AS pre_game_rating,
      count(*) OVER (PARTITION BY gu.game_id, gu.team) AS team_size
    FROM games_users gu
    LEFT JOIN matchmaking_rating_changes mrc
      ON mrc.game_id = gu.game_id AND mrc.user_id = gu.user_id
    WHERE gu.game_id = ANY(game_ids)
  ),
  readable_games AS (
    SELECT
      game_id,
      min(matchmaking_type) AS matchmaking_type,
      min(change_date) AS change_date,
      avg(pre_game_rating) AS mean_rating
    FROM roster
    GROUP BY game_id
    HAVING bool_and(team IS NOT NULL AND assigned_race IS NOT NULL)
      AND count(DISTINCT team) = 2
      AND min(team_size) = max(team_size)
      AND count(matchmaking_type) > 0
  ),
  sides AS (
    SELECT
      r.game_id,
      r.team,
      string_agg(r.assigned_race::text, '' ORDER BY
        CASE r.assigned_race WHEN 't' THEN 0 WHEN 'p' THEN 1 ELSE 2 END) AS races,
      bool_and(r.outcome = 'win') AS won
    FROM roster r
    JOIN readable_games rg ON rg.game_id = r.game_id
    GROUP BY r.game_id, r.team
  ),
  seasons AS (
    SELECT id, start_date, lead(start_date) OVER (ORDER BY start_date) AS end_date
    FROM matchmaking_seasons
  )
  INSERT INTO matchup_sides (
    game_id, team, matchmaking_type, season_id, map_id, races, opponent_races, mean_rating, won
  )
  SELECT
    s.game_id, s.team, rg.matchmaking_type, se.id, g.map_id, s.races, o.races, rg.mean_rating,
    s.won
  FROM sides s
  JOIN sides o ON o.game_id = s.game_id AND o.team <> s.team
  JOIN readable_games rg ON rg.game_id = s.game_id
  JOIN games g ON g.id = s.game_id
  JOIN seasons se
    ON rg.change_date >= se.start_date AND (se.end_date IS NULL OR rg.change_date < se.end_date)
  WHERE s.won IS NOT NULL;
$$;
