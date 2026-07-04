-- Records matchmaking/league point refunds ("game nullification") applied by an admin after an
-- actioned game report, e.g. when a cheater's win or a griefed ally's loss unjustly cost the
-- victims ranked points. Scope is points only (no MMR reversal, no clawbacks) for the current
-- season. See the games nullify-points admin endpoint / game-points-refund-service.
--
-- Keyed by game alone so a game is refunded at most once (a game can have several actioned
-- reports, but must not be refunded twice). Per-user amounts live in `details` for audit; the
-- authoritative record of every point change is still matchmaking_rating_changes /
-- league_user_changes.
CREATE TABLE game_points_refunds (
  game_id uuid PRIMARY KEY REFERENCES games (id) ON DELETE CASCADE,
  -- The admin who issued the refund. SET NULL rather than CASCADE: the refund record should
  -- outlive the admin's account being deleted.
  refunded_by integer REFERENCES users (id) ON DELETE SET NULL,
  refunded_at timestamptz NOT NULL DEFAULT now(),
  -- Per-user audit of what was restored, as
  -- [{ "userId", "matchmakingType", "pointsRefunded", "bonusRefunded" }, ...].
  details jsonb NOT NULL
);
