-- Dedicated storage for player reports filed from a game's results page (distinct from
-- bug_reports, which players were previously abusing for this). Backed by server-rs; see the
-- game_reports GraphQL module.
CREATE TABLE game_reports (
  id uuid PRIMARY KEY DEFAULT sb_uuid(),
  game_id uuid NOT NULL REFERENCES games (id) ON DELETE CASCADE,
  reporter_id integer NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- The player being reported. Always set: every report targets a specific player (game-scoped
  -- concerns like map bugs are bug reports, and things like win-trading still have a reportable
  -- participant). CASCADE matches reporter_id — a report has no meaning once either party is gone.
  reported_user_id integer NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- Stored as text rather than a PG enum so adding/renaming reasons is a code-only change,
  -- matching how the codebase keeps these unions in TS/Rust. The only writer is server-rs, through
  -- a fixed Rust enum, so malformed values can't arrive via the app path.
  reason text NOT NULL,
  details text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolver_id integer REFERENCES users (id) ON DELETE SET NULL,
  -- The *outcome* of resolution (actioned / dismissed / abusive / duplicate), not just the fact of
  -- it. This is what makes reporter credibility computable, and it can't be backfilled for reports
  -- resolved before it existed, so it ships from day one. Text, same rationale as `reason`.
  resolution text,
  resolution_notes text,

  -- One report per reporter per target per game (anti-spam). All three columns are NOT NULL, so
  -- plain UNIQUE is exactly right. Dedupes regardless of reason (the details field covers
  -- "and also...").
  UNIQUE (reporter_id, game_id, reported_user_id),

  -- Keep the resolved-state columns consistent. resolver_id is intentionally excluded: its FK is
  -- ON DELETE SET NULL, so a resolved report can legitimately end up with a null resolver.
  CONSTRAINT game_reports_resolution_consistent CHECK ((resolved_at IS NULL) = (resolution IS NULL))
);

-- Admin queue: unresolved reports, newest first. Partial so it stays small; an include-resolved
-- listing seq-scans, which is fine at this table's size.
CREATE INDEX game_reports_unresolved_index ON game_reports (created_at DESC) WHERE resolved_at IS NULL;
-- "All reports against this user" (moderation workflow / reported-user credibility stats).
CREATE INDEX game_reports_reported_user_index ON game_reports (reported_user_id);
