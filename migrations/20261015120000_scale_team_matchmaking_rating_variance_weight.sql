-- Team-mode ratings are updated against the whole team's expected result, which spreads them out
-- much further than the 1v1 rating scale the default skill-variance weight was set for: a typical
-- 2v2 roster's rating variance is about 2.6x larger, and a 3v3 roster's about 4.3x. Scale the
-- variance weight down for those modes so a typical roster's skill penalty (in seconds of wait)
-- stays about the same. Applied as per-mode overrides (merged into any existing overrides for those
-- modes) so the values stay visible and editable in the admin matchmaking config.
UPDATE matchmaking_config
SET
  config = jsonb_set(
    config,
    '{perMode}',
    coalesce(config -> 'perMode', '{}'::jsonb) || (
      SELECT jsonb_object_agg(
        mode,
        coalesce(config -> 'perMode' -> mode, '{}'::jsonb)
          || jsonb_build_object('weightRatingVariance', weight)
      )
      FROM (
        VALUES
          ('2v2', 0.002),
          ('2v2bgh', 0.002),
          ('2v2hunters', 0.002),
          ('2v2fastest', 0.002),
          ('3v3bgh', 0.00125),
          ('3v3hunters', 0.00125),
          ('3v3fastest', 0.00125)
      ) AS team_modes (mode, weight)
    )
  ),
  updated_at = now(),
  updated_by = NULL
WHERE id = 1;

-- Every committed config change has a matching audit row.
INSERT INTO matchmaking_config_history (config)
SELECT config FROM matchmaking_config WHERE id = 1;
