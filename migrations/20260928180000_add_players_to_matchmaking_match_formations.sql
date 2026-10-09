-- Records who was in each formed match, and their rating in the mode when the match formed, so
-- failed-to-start matches (which have no game or games_users rows) can still be traced to their
-- players. This lets formation telemetry separate the effect of a wide skill spread from the effect
-- of a new or uncertain player being in the match, and lets calibration recompute team ratings from
-- plain ratings rather than only the matchmaker's effective ones.
--
-- Each team's two arrays are index-aligned: team_a_player_ratings[i] belongs to
-- team_a_user_ids[i]. Team A and team B follow the matchmaker's team order. In team modes,
-- they correspond to game config teams 0 and 1. In 1v1 modes, the game config stores both
-- opponents in teams[0], while these arrays keep the two sides separate.
-- Nullable since rows recorded before this change have no player information.

ALTER TABLE matchmaking_match_formations
  ADD COLUMN team_a_user_ids integer[],
  ADD COLUMN team_b_user_ids integer[],
  ADD COLUMN team_a_player_ratings real[],
  ADD COLUMN team_b_player_ratings real[];
