-- Aggregated play statistics for maps, rebuilt from `games` by a periodic job on the server. Rows
-- only ever hold raw counts; thresholds for showing a value (e.g. a minimum number of games behind
-- a winrate) are applied when reading, so they can change without recomputing anything.

-- One row per map that has been played: the per-map values that map listings sort and filter by.
CREATE TABLE map_stats (
  map_id uuid PRIMARY KEY REFERENCES maps (id) ON DELETE CASCADE,
  games_7d integer NOT NULL,
  games_28d integer NOT NULL,
  games_90d integer NOT NULL,
  -- Distinct users who played the map in the last 90 days. Not derivable from `map_stats_daily`,
  -- since one user playing on many days would be counted once per day.
  players_90d integer NOT NULL,
  games_total integer NOT NULL,
  -- In milliseconds, over the last 90 days' games with a known length.
  median_length_90d integer,
  last_played_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

-- Games played on each map per UTC day, split by where the game came from.
CREATE TABLE map_stats_daily (
  map_id uuid NOT NULL REFERENCES maps (id) ON DELETE CASCADE,
  day date NOT NULL,
  -- `config->>'gameSource'` and `config->>'gameType'` of the games counted.
  game_source text NOT NULL,
  game_type text NOT NULL,
  games integer NOT NULL,
  -- The number of users across those games, counting a user once per game they played.
  player_games integer NOT NULL,
  PRIMARY KEY (map_id, day, game_source, game_type)
);

CREATE INDEX map_stats_daily_day_index ON map_stats_daily (day);

-- Matchmaking results on each map per season, for matchup winrates. Only counts games that say
-- something about how the map plays: see the job for what makes a game decided.
CREATE TABLE map_matchup_stats (
  map_id uuid NOT NULL REFERENCES maps (id) ON DELETE CASCADE,
  season_id integer NOT NULL REFERENCES matchmaking_seasons (id) ON DELETE CASCADE,
  matchmaking_type matchmaking_type NOT NULL,
  -- A canonical matchup string, as in `games.assigned_matchup` (e.g. `p-z`, `pt-tz`).
  matchup text NOT NULL,
  games integer NOT NULL,
  -- Games won by the races on the left and right of `matchup`. Both stay 0 for mirror matchups,
  -- whose sides can't be told apart.
  left_wins integer NOT NULL,
  right_wins integer NOT NULL,
  PRIMARY KEY (map_id, season_id, matchmaking_type, matchup)
);

CREATE INDEX map_matchup_stats_season_id_index ON map_matchup_stats (season_id);
