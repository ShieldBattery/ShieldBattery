-- Extend matchmaking_match_formations to also capture matches the matchmaker formed but that *failed
-- to start* — i.e. fell apart during accept/draft/load and never produced a game. Previously a row
-- was written only once a match successfully loaded (keyed by game_id), so failed-start cohorts had no
-- persisted quality/win-probability/rating/latency inputs and couldn't be joined back to the
-- matchmaker decision that produced them.
--
-- A row now represents one formed match's decision, regardless of outcome:
--   * launched   -> game_id set, fail_phase NULL (joinable to the game's outcome for calibration)
--   * failed     -> game_id NULL, fail_phase set to the phase it fell apart in
-- game_id can therefore no longer be the primary key (it's NULL for failures), so a surrogate id takes
-- over; game_id keeps its games FK + cascade and gains a UNIQUE constraint so there's still at most one
-- formation per game. Existing rows are all launched matches, so they keep their game_id and get a
-- NULL fail_phase automatically.

ALTER TABLE matchmaking_match_formations
  DROP CONSTRAINT matchmaking_match_formations_pkey;

ALTER TABLE matchmaking_match_formations
  ALTER COLUMN game_id DROP NOT NULL;

ALTER TABLE matchmaking_match_formations
  ADD COLUMN id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY;

-- NULL for launched matches; otherwise the phase the match fell apart in. Mirrors the `phase` the
-- matchmaking service tracks (and labels the failure metric with), so the two stay aligned.
ALTER TABLE matchmaking_match_formations
  ADD COLUMN fail_phase text CHECK (fail_phase IN ('accepting', 'drafting', 'loading'));

ALTER TABLE matchmaking_match_formations
  ADD CONSTRAINT matchmaking_match_formations_game_id_key UNIQUE (game_id);
