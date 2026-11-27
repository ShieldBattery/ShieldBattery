-- Ranked records by race matchup, rebuilt from `games` by a periodic job on the server (see
-- `server/lib/matchmaking/matchup-stats-models.ts`). Rows only ever hold raw counts; thresholds for
-- showing a winrate are applied when reading.
--
-- Both tables count the same games, so a player's record and the ladder's can be compared directly:
-- ranked games of at least 2 minutes with exactly two teams, one of which won, and every player's
-- team and race known.
--
-- `races` and `opponent_races` are each one team's races, sorted (e.g. `p`, `pt`, `zz`), so a row
-- reads as "`races` against `opponent_races`".

-- Each player's record per mode, season and matchup, from their own team's side.
CREATE TABLE user_matchup_stats (
  user_id integer NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  matchmaking_type matchmaking_type NOT NULL,
  season_id integer NOT NULL REFERENCES matchmaking_seasons (id) ON DELETE CASCADE,
  races text NOT NULL,
  opponent_races text NOT NULL,
  wins integer NOT NULL,
  losses integer NOT NULL,
  PRIMARY KEY (user_id, matchmaking_type, season_id, races, opponent_races)
);

CREATE INDEX user_matchup_stats_season_id_index ON user_matchup_stats (season_id);

-- The whole ladder's record per mode, season and matchup. Every game is counted once from each
-- team's side (not once per player), so a `p`/`z` game adds to both `p` against `z` and `z` against
-- `p`, and a mirror game adds one win and one loss to its single row.
CREATE TABLE ladder_matchup_stats (
  matchmaking_type matchmaking_type NOT NULL,
  season_id integer NOT NULL REFERENCES matchmaking_seasons (id) ON DELETE CASCADE,
  races text NOT NULL,
  opponent_races text NOT NULL,
  wins integer NOT NULL,
  losses integer NOT NULL,
  PRIMARY KEY (matchmaking_type, season_id, races, opponent_races)
);

CREATE INDEX ladder_matchup_stats_season_id_index ON ladder_matchup_stats (season_id);
