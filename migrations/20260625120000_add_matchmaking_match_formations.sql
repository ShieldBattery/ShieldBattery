-- Captures the matchmaker's own decision for each matchmaking game: the quality score the match
-- formed at, plus the raw inputs that fed that score (skill variance, win probability, per-team
-- effective ratings, max latency bucket). Keyed by game_id so the formation decision can be joined
-- to the game's actual outcome (length, result) for calibrating the quality weights against real
-- games. Populated going forward by the matchmaking service when a match successfully loads.
--
-- We store the raw, unweighted inputs (not the pre-weighted penalty terms) so the weights can be
-- re-derived later without losing information if they change. game_id is the PK (one formation per
-- game) with a cascading FK so a deleted/failed game doesn't leave an orphan row.
--
-- Also adds `rating` to matchmaking_completions: the player's rating in that mode at queue time, so
-- queue health (search/cancel times, abandonment) can be sliced by skill band without reconstructing
-- the player's (mutating) rating after the fact. Nullable since historical rows have no value.

CREATE TABLE matchmaking_match_formations (
  game_id uuid NOT NULL PRIMARY KEY REFERENCES games (id) ON DELETE CASCADE,
  matchmaking_type matchmaking_type NOT NULL,
  -- Overall quality score (in seconds of wait) the match formed at.
  quality real NOT NULL,
  -- Variance of the matched players' effective ratings (raw skill-spread input to quality).
  skill_variance real NOT NULL,
  -- Win probability of team A vs team B from the matchmaker's logistic (0.5 == balanced).
  win_probability real NOT NULL,
  -- Effective team ratings used to compute win_probability.
  team_a_rating real NOT NULL,
  team_b_rating real NOT NULL,
  -- Highest latency bucket among the matched players (raw latency input to quality).
  max_latency real NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE matchmaking_completions
  ADD COLUMN rating real;
