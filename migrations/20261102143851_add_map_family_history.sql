-- Trusted users outside staff who work the families queue, for listed maps only. They rank above
-- publishers and below staff, so staff placements stay locked to them.
ALTER TYPE map_link_source ADD VALUE IF NOT EXISTS 'reviewer' BEFORE 'moderator';

-- Every change a person makes to families, suggestions and family reports, so a reviewer's
-- decisions can be checked and undone. Changes the detection rules make aren't recorded.
CREATE TABLE map_family_history (
  id uuid PRIMARY KEY DEFAULT sb_uuid(),
  -- `link`, `remove`, `update_member`, `set_label`, `decide_suggestion` or `report_status`.
  kind text NOT NULL CHECK (kind IN ('link', 'remove', 'update_member', 'set_label',
    'decide_suggestion', 'report_status')),
  actor integer NOT NULL REFERENCES users (id),
  -- The role the actor acted in: `publisher`, `reviewer` or `moderator`.
  source map_link_source NOT NULL,
  -- The map the change was about, and the other map of a link, suggestion or report. NULL only
  -- for a family label change.
  map_id uuid REFERENCES maps (id) ON DELETE CASCADE,
  other_map_id uuid REFERENCES maps (id) ON DELETE CASCADE,
  -- The family of a label change. Not a foreign key: the record outlives a family that empties.
  family_id uuid,
  -- What changed: `members` (each changed member's place before and after, null when it wasn't in
  -- a family), `suggestions` (each pair whose status changed), `label` and `reportStatus` (before
  -- and after), and `reportId`.
  details jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX map_family_history_created_at_index ON map_family_history (created_at DESC, id);
CREATE INDEX map_family_history_map_index ON map_family_history (map_id, created_at DESC);
CREATE INDEX map_family_history_other_map_index ON map_family_history (other_map_id, created_at DESC);
CREATE INDEX map_family_history_family_index ON map_family_history (family_id, created_at DESC)
  WHERE family_id IS NOT NULL;
CREATE INDEX map_family_history_actor_index ON map_family_history (actor, created_at DESC);
