-- A map's owner: its original maker, at most one per family. `owner_kind` says how they became the
-- owner: `claim` when they claimed a map whose every listed file they published, `staff` when staff
-- granted a claim or set them as the owner. `owner_set_by` is whoever made that change (the owner
-- themselves for a `claim`). The owner picks the family's default file and can add or remove files.
--
-- `credit` is a maker's name typed by staff, for a maker who has no account. A family with a credit
-- can't be claimed without staff.
ALTER TABLE map_families
  ADD COLUMN owner_id integer REFERENCES users (id),
  ADD COLUMN owner_kind text CHECK (owner_kind IN ('claim', 'staff')),
  ADD COLUMN owner_set_by integer REFERENCES users (id),
  ADD COLUMN owner_set_at timestamptz,
  ADD COLUMN credit text CHECK (char_length(btrim(credit)) BETWEEN 1 AND 100),
  ADD CONSTRAINT map_families_owner_set_check CHECK (
    (owner_id IS NULL AND owner_kind IS NULL AND owner_set_by IS NULL AND owner_set_at IS NULL)
    OR (owner_id IS NOT NULL AND owner_kind IS NOT NULL AND owner_set_by IS NOT NULL
      AND owner_set_at IS NOT NULL)
  );

CREATE INDEX map_families_owner_id_index ON map_families (owner_id) WHERE owner_id IS NOT NULL;

-- Users claiming to be the maker of a map. Every claim has a row: one granted at once because the
-- claimant published every listed file of a map nobody owned (`resolved_by` is then the claimant),
-- and one waiting for staff to grant or reject it. `family_id` isn't a foreign key, since families
-- can be merged away; it's read through `map_family_aliases`, except that open claims move along
-- with a merge.
CREATE TABLE map_owner_claims (
  id uuid PRIMARY KEY DEFAULT sb_uuid(),
  family_id uuid NOT NULL,
  claimant integer NOT NULL REFERENCES users (id),
  -- What the claimant told staff. Required for claims staff review, NULL for one granted at once.
  note text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'granted', 'rejected')),
  resolved_by integer REFERENCES users (id),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'open') = (resolved_by IS NULL)),
  CHECK ((status = 'open') = (resolved_at IS NULL))
);

-- One open claim per claimant and map: claiming again updates its note.
CREATE UNIQUE INDEX map_owner_claims_open_unique_index ON map_owner_claims (family_id, claimant)
  WHERE status = 'open';
CREATE INDEX map_owner_claims_status_index ON map_owner_claims (status, created_at, id);
CREATE INDEX map_owner_claims_claimant_index ON map_owner_claims (claimant, created_at);

-- `set_owner`, `remove_owner` and `set_credit` record changes to a family's owner and credit.
ALTER TABLE map_family_history
  DROP CONSTRAINT map_family_history_kind_check,
  ADD CONSTRAINT map_family_history_kind_check
    CHECK (kind IN ('move_file', 'merge', 'split', 'set_default', 'clear_default',
      'report_status', 'publish', 'unpublish', 'delist', 'relist', 'link', 'unlink', 'set_owner',
      'remove_owner', 'set_credit'));

-- `wrong_owner`: the family's owner didn't make the map. Names only the family.
-- `wrong_default`: a family with no owner should have another default file, the one in `map_id`.
-- `inappropriate`: a file (`map_id`) has an inappropriate name, description or content.
ALTER TABLE map_family_reports
  DROP CONSTRAINT map_family_reports_kind_check,
  DROP CONSTRAINT map_family_reports_map_id_check,
  ADD CONSTRAINT map_family_reports_kind_check
    CHECK (kind IN ('wrong_map', 'same_map', 'publish_review', 'wrong_owner', 'wrong_default',
      'inappropriate')),
  ADD CONSTRAINT map_family_reports_map_id_check
    CHECK ((kind IN ('wrong_map', 'publish_review', 'wrong_default', 'inappropriate'))
      = (map_id IS NOT NULL));

-- One open report per reporter and subject. A report naming neither a file nor another family
-- (`wrong_owner`) is about the family itself.
DROP INDEX map_family_reports_open_unique_index;
CREATE UNIQUE INDEX map_family_reports_open_unique_index
  ON map_family_reports (reported_by, kind, family_id, COALESCE(map_id, other_family_id, family_id))
  WHERE status = 'open';
