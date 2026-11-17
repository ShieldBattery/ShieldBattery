-- The weekly feature slot: one staff pick per week, of a map (`family_id`) or a collection
-- (`collection_id`). `week` is the Monday (UTC) the week starts; a week runs from that Monday 00:00
-- UTC to the next. When a map is merged into another, its rows move to the map it was merged into.
-- `notified_at` is when the featured map's maker was told about the pick, and is reset whenever the
-- week's pick changes to another map or collection.
CREATE TABLE map_features (
  week date PRIMARY KEY CHECK (extract(isodow FROM week) = 1),
  family_id uuid REFERENCES map_families (id) ON DELETE CASCADE,
  collection_id uuid REFERENCES collections (id) ON DELETE CASCADE,
  blurb text NOT NULL DEFAULT '' CHECK (char_length(blurb) <= 400),
  created_by integer NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  notified_at timestamptz,
  CHECK ((family_id IS NULL) <> (collection_id IS NULL))
);

-- A map's featured weeks, and moving rows along when a map is merged away.
CREATE INDEX map_features_family_id_index ON map_features (family_id) WHERE family_id IS NOT NULL;
