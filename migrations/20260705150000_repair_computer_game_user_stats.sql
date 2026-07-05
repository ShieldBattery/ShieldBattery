-- Repairs users' aggregate race win/loss tallies (user_stats) so games containing computer players
-- no longer count toward them. Games with a computer opponent are not a real competitive record --
-- computers report nothing, so any win/loss "reconciled" around them was guesswork -- and such games
-- are now hidden from the platform and never reconciled going forward. Historically they DID
-- reconcile and DID increment the race-scoped win/loss counters below, so hiding them prospectively
-- would leave stale tallies behind. This rebuilds the counters from the games that should count.
--
-- Only the race win/loss counters in user_stats are affected: those are the only stats a lobby
-- (non-matchmaking) game touches, and computer games only ever occur in lobby games. Matchmaking
-- ratings, ranks, points, and league standings are matchmaking-only and matchmaking never contains
-- computers, so none of that data needs repair.
--
-- The rebuild is exact because the counters are a pure function of persisted rows. A reconciled
-- game increments, per human player with a win or loss:
--   * <selected_race>_wins / <selected_race>_losses   (p/t/z/r), and
--   * r_<assigned_race>_wins / r_<assigned_race>_losses  additionally, when the selected race was
--     random.
-- It does so only for non-UMS games whose reconciliation was not disputed, and only counts a player
-- whose reconciled result is exactly win or loss (draw/unknown never count). Every input to that --
-- selected race, assigned race, result, game type, disputed flag -- is stored on games_users /
-- games, and a game reconciles at most once, so recounting those rows reproduces each counter
-- exactly. user_stats has no other writers (only per-user init to zero at signup and this reconcile
-- increment), so nothing outside this derivation contributes.
--
-- Computer presence is derived from the stored config JSON, not from the newer resultsExempt flag:
-- legacy computer games predate that flag. Each config's teams are a nested array of player objects
-- (config.teams -> array of teams -> array of {id, race, isComputer}); a game has a computer when
-- any player object across all teams has isComputer = true.
--
-- Scope: only users who played at least one computer game are touched. For any other user the
-- recompute would reproduce their existing counters exactly, so leaving their row untouched is both
-- correct and makes the migration's effect auditable. Re-running yields the same state (each counter
-- is set to an absolute recomputed value, not decremented), and the work is fully set-based.

WITH computer_game_players AS (
  -- Users who ever played a game containing a computer player. These are the only users whose
  -- counters can currently include a computer-game contribution.
  SELECT DISTINCT gu.user_id
  FROM games_users gu
  JOIN games g ON g.id = gu.game_id
  WHERE g.config->'teams' @? '$[*][*] ? (@.isComputer == true)'
),
countable_results AS (
  -- Every games_users row that legitimately contributes to a user's win/loss counters: a reconciled,
  -- non-disputed, non-UMS game with no computer players, where the player's reconciled result was a
  -- win or a loss. Mirrors exactly the reconcile-time increment conditions.
  SELECT
    gu.user_id,
    gu.selected_race,
    gu.assigned_race,
    gu.result
  FROM games_users gu
  JOIN games g ON g.id = gu.game_id
  WHERE g.results IS NOT NULL
    AND g.disputable IS NOT TRUE
    AND g.config->>'gameType' IS DISTINCT FROM 'ums'
    AND gu.result IN ('win', 'loss')
    AND NOT (g.config->'teams' @? '$[*][*] ? (@.isComputer == true)')
),
recomputed AS (
  -- Rebuild all 14 counters for each affected user from their countable results. A user who only
  -- ever played computer games has no countable results, so the LEFT JOIN leaves every counter at 0.
  SELECT
    cgp.user_id,
    count(*) FILTER (WHERE cr.selected_race = 'p' AND cr.result = 'win')  AS p_wins,
    count(*) FILTER (WHERE cr.selected_race = 'p' AND cr.result = 'loss') AS p_losses,
    count(*) FILTER (WHERE cr.selected_race = 't' AND cr.result = 'win')  AS t_wins,
    count(*) FILTER (WHERE cr.selected_race = 't' AND cr.result = 'loss') AS t_losses,
    count(*) FILTER (WHERE cr.selected_race = 'z' AND cr.result = 'win')  AS z_wins,
    count(*) FILTER (WHERE cr.selected_race = 'z' AND cr.result = 'loss') AS z_losses,
    count(*) FILTER (WHERE cr.selected_race = 'r' AND cr.result = 'win')  AS r_wins,
    count(*) FILTER (WHERE cr.selected_race = 'r' AND cr.result = 'loss') AS r_losses,
    count(*) FILTER (
      WHERE cr.selected_race = 'r' AND cr.assigned_race = 'p' AND cr.result = 'win'
    ) AS r_p_wins,
    count(*) FILTER (
      WHERE cr.selected_race = 'r' AND cr.assigned_race = 'p' AND cr.result = 'loss'
    ) AS r_p_losses,
    count(*) FILTER (
      WHERE cr.selected_race = 'r' AND cr.assigned_race = 't' AND cr.result = 'win'
    ) AS r_t_wins,
    count(*) FILTER (
      WHERE cr.selected_race = 'r' AND cr.assigned_race = 't' AND cr.result = 'loss'
    ) AS r_t_losses,
    count(*) FILTER (
      WHERE cr.selected_race = 'r' AND cr.assigned_race = 'z' AND cr.result = 'win'
    ) AS r_z_wins,
    count(*) FILTER (
      WHERE cr.selected_race = 'r' AND cr.assigned_race = 'z' AND cr.result = 'loss'
    ) AS r_z_losses
  FROM computer_game_players cgp
  LEFT JOIN countable_results cr ON cr.user_id = cgp.user_id
  GROUP BY cgp.user_id
)
UPDATE user_stats us
SET
  p_wins     = r.p_wins,
  p_losses   = r.p_losses,
  t_wins     = r.t_wins,
  t_losses   = r.t_losses,
  z_wins     = r.z_wins,
  z_losses   = r.z_losses,
  r_wins     = r.r_wins,
  r_losses   = r.r_losses,
  r_p_wins   = r.r_p_wins,
  r_p_losses = r.r_p_losses,
  r_t_wins   = r.r_t_wins,
  r_t_losses = r.r_t_losses,
  r_z_wins   = r.r_z_wins,
  r_z_losses = r.r_z_losses
FROM recomputed r
WHERE us.user_id = r.user_id;
