-- Map tags: words saying what kind of map a map (family) is, from a list staff manage. A tag's `id`
-- is fixed when it's created, and is what links and history hold; its `kind` is fixed too. `name`
-- is its English name, unique among the tags of its kind ignoring case, and `names` holds its names
-- in other languages, an object of locale code to name: a language without an entry shows the
-- English name. Every tag applies to a map only while the map's current file is of the tag's kind:
-- tags of the other kind are ignored, and dropped the next time someone edits the map's tags.
-- `position` is the order of the tags of a kind, counting from 0; its uniqueness is checked at
-- commit, so one transaction can rewrite every position of a kind. The list shows melee tags first,
-- then UMS tags.
CREATE TABLE map_tags (
  id text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('melee', 'ums')),
  position integer NOT NULL,
  name text NOT NULL,
  names jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(names) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT map_tags_position_key UNIQUE (kind, position) DEFERRABLE INITIALLY DEFERRED
);

CREATE UNIQUE INDEX map_tags_name_index ON map_tags (kind, lower(name));

-- The tags of each map. `source` says who set a tag, which decides who may take it off: `staff`
-- over `maker` (the map's owner) over `player`. `set_by` is the user who set it. Rows go with their
-- map when it's merged away, and with their tag when it's deleted.
CREATE TABLE map_family_tags (
  family_id uuid NOT NULL REFERENCES map_families (id) ON DELETE CASCADE,
  tag_id text NOT NULL REFERENCES map_tags (id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('player', 'maker', 'staff')),
  set_by integer NOT NULL REFERENCES users (id),
  set_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (family_id, tag_id)
);

-- Listings filter maps by tag.
CREATE INDEX map_family_tags_tag_id_index ON map_family_tags (tag_id, family_id);

-- `set_tags` records a change to a map's tags.
ALTER TABLE map_family_history
  DROP CONSTRAINT map_family_history_kind_check,
  ADD CONSTRAINT map_family_history_kind_check
    CHECK (kind IN ('move_file', 'merge', 'split', 'set_default', 'clear_default',
      'report_status', 'publish', 'unpublish', 'delist', 'relist', 'link', 'unlink', 'set_owner',
      'remove_owner', 'set_credit', 'set_tags'));
