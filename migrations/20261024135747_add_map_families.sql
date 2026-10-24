-- Map families: versions, variants, translations and forks of one map, grouped from its files.
-- Detection proposes links between pairs of files (`map_link_suggestions`); accepted links place a
-- file in a family (`map_family_members`).

-- When the file first showed up on ShieldBattery, the ordering signal for files without a version
-- in their name. Backfilled from the earliest trace of the file.
ALTER TABLE maps ADD COLUMN first_seen_at timestamptz;

UPDATE maps AS m
SET first_seen_at = COALESCE(
  LEAST(
    (SELECT min(u.upload_date) FROM uploaded_maps_legacy AS u WHERE u.map_hash = m.hash),
    (SELECT min(l.added_at) FROM map_library AS l WHERE l.map_id = m.id),
    m.published_at,
    (SELECT min(g.start_time) FROM games AS g WHERE g.map_id = m.id)
  ),
  now()
);

ALTER TABLE maps
  ALTER COLUMN first_seen_at SET NOT NULL,
  ALTER COLUMN first_seen_at SET DEFAULT now();

ALTER TABLE map_analysis
  -- SHA-256 of the file's `scenario.chk`: files that differ only in MPQ packing share it. NULL
  -- until the file is parsed by parser version 4 or later.
  ADD COLUMN chk_hash bytea,
  -- Who the map's description says made it ("Created by X", "Remake by X") and who it credits as
  -- the original ("Original by X", "Inspired by X"), normalized for comparison (lowercase, letters
  -- and digits only). Used to tell versions from forks.
  ADD COLUMN makers text[] NOT NULL DEFAULT '{}',
  ADD COLUMN credited text[] NOT NULL DEFAULT '{}',
  -- The family detection rules version this map was last scanned under. Reset when the map is
  -- reparsed, so it's scanned again with the new analysis.
  ADD COLUMN family_scan_version smallint;

CREATE INDEX map_analysis_chk_hash_index ON map_analysis (chk_hash);

CREATE TYPE map_family_relation AS ENUM ('root', 'version', 'variant', 'translation', 'fork');
CREATE TYPE map_link_source AS ENUM ('rule', 'publisher', 'moderator');

CREATE TABLE map_families (
  id uuid PRIMARY KEY DEFAULT sb_uuid(),
  -- A staff-only working label for the queue. Never shown publicly: families show their
  -- representative map's own name.
  label text,
  -- The current version of the root's line. Derived on every write to the family.
  current_map_id uuid REFERENCES maps (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- A file is in at most one family. Members form a tree: a `version` supersedes its parent, a
-- `variant` or `translation` sits beside its parent without superseding it, and a `fork` starts a
-- new line (a separate catalog tile with its own current version).
CREATE TABLE map_family_members (
  map_id uuid PRIMARY KEY REFERENCES maps (id) ON DELETE CASCADE,
  family_id uuid NOT NULL REFERENCES map_families (id) ON DELETE CASCADE,
  -- NULL for the family's root. A member whose parent was deleted also has none, and counts as the
  -- start of its own line until staff place it again.
  parent_map_id uuid REFERENCES map_family_members (map_id) ON DELETE SET NULL,
  relation map_family_relation NOT NULL,
  -- The version parsed from the file ("1.75", "SE 2.0"), editable by staff. Orders a line.
  version_label text,
  pinned_current boolean NOT NULL DEFAULT false,
  source map_link_source NOT NULL,
  linked_by integer REFERENCES users (id),
  linked_at timestamptz NOT NULL,
  -- Derived on every write to the family: the nearest ancestor-or-self that starts a line (the
  -- root, a fork, or a member without a parent), and that line's current version.
  line_root_id uuid NOT NULL,
  line_current_id uuid NOT NULL
);

CREATE INDEX map_family_members_family_id_index ON map_family_members (family_id);
CREATE INDEX map_family_members_parent_map_id_index ON map_family_members (parent_map_id);
CREATE INDEX map_family_members_line_root_id_index ON map_family_members (line_root_id);
CREATE UNIQUE INDEX map_family_members_pinned_current_index ON map_family_members (line_root_id)
  WHERE pinned_current;

-- Pairs of files detection found to be possibly related, and what became of them. Kept after a
-- decision so a rejected pair is never proposed again.
CREATE TABLE map_link_suggestions (
  map_a uuid NOT NULL REFERENCES maps (id) ON DELETE CASCADE,
  map_b uuid NOT NULL REFERENCES maps (id) ON DELETE CASCADE,
  -- Terrain similarity of the pair (same dimensions only), and the fingerprint version it was
  -- computed with. NULL when the pair was found by name alone.
  terrain_similarity real,
  fingerprint_version smallint,
  name_match boolean NOT NULL,
  -- The detection rules' proposal: `{"relation", "older", "rule"}`, where `relation` is a
  -- `map_family_relation` (not `root`), `terrain_only`, `unrelated` or null (no proposal), and
  -- `older` is `a`, `b` or null.
  verdict jsonb NOT NULL,
  verdict_rules_version smallint NOT NULL,
  -- `open` (waiting for staff), `accepted`, `rejected`, or `terrain_only` (a UMS map built on the
  -- other's terrain: related, but never a family member).
  status text NOT NULL CHECK (status IN ('open', 'accepted', 'rejected', 'terrain_only')),
  -- Who decided, NULL when the detection rules did.
  decided_by integer REFERENCES users (id),
  decided_at timestamptz,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (map_a, map_b),
  CHECK (map_a < map_b)
);

CREATE INDEX map_link_suggestions_open_index ON map_link_suggestions (status)
  WHERE status = 'open';
CREATE INDEX map_link_suggestions_map_b_index ON map_link_suggestions (map_b);
