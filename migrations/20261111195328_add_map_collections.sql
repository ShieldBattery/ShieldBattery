-- Collections: named, ordered lists of maps.
--
-- `user`: made by a player (`owner_id`), with a title they typed. Private until they make it public
-- (`published_at`).
-- `starred`: each player's own list of starred maps, at most one per player. It has no title (the
-- client names it) and is never public. Its entries are ordered newest first.
-- `staff`: made and edited by staff, with no owner. Everyone can see it.
-- `ladder_pool`: a ladder map pool, with no owner and no title.
--
-- Staff can hide a public `user` collection (`hidden_*`), which keeps everyone but its owner and
-- staff from seeing it.
CREATE TYPE collection_kind AS ENUM ('user', 'starred', 'staff', 'ladder_pool');

CREATE TABLE collections (
  id uuid PRIMARY KEY DEFAULT sb_uuid(),
  kind collection_kind NOT NULL,
  owner_id integer REFERENCES users (id),
  title text CHECK (char_length(title) BETWEEN 3 AND 50),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 500),
  published_at timestamptz,
  hidden_at timestamptz,
  hidden_by integer REFERENCES users (id),
  hidden_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((owner_id IS NOT NULL) = (kind IN ('user', 'starred'))),
  CHECK ((title IS NOT NULL) = (kind IN ('user', 'staff'))),
  CHECK (published_at IS NULL OR kind = 'user'),
  CHECK (hidden_at IS NULL OR kind = 'user'),
  CHECK ((hidden_at IS NULL) = (hidden_by IS NULL)),
  CHECK ((hidden_at IS NULL) = (hidden_note IS NULL))
);

-- One Starred per player, and no two of a player's collections with the same title (ignoring case).
CREATE UNIQUE INDEX collections_starred_owner_unique_index ON collections (owner_id)
  WHERE kind = 'starred';
CREATE UNIQUE INDEX collections_user_title_unique_index ON collections (owner_id, lower(title))
  WHERE kind = 'user';
CREATE INDEX collections_owner_id_index ON collections (owner_id) WHERE owner_id IS NOT NULL;
CREATE INDEX collections_kind_index ON collections (kind, created_at);

-- The maps in a collection. An entry is either a map (`family_id`), which plays that map's current
-- file and follows it through merges, or an exact file (`map_id`). A map is in a collection at most
-- once. `position` orders the entries from 0; every entry of a Starred collection has position 0
-- and they're ordered by `added_at`, newest first. `added_at` is NULL only for stars from before
-- their date was recorded.
CREATE TABLE collection_maps (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  collection_id uuid NOT NULL REFERENCES collections (id) ON DELETE CASCADE,
  family_id uuid REFERENCES map_families (id) ON DELETE CASCADE,
  map_id uuid REFERENCES maps (id) ON DELETE CASCADE,
  position integer NOT NULL,
  added_at timestamptz DEFAULT now(),
  CHECK ((family_id IS NULL) <> (map_id IS NULL))
);

CREATE UNIQUE INDEX collection_maps_family_unique_index
  ON collection_maps (collection_id, family_id)
  WHERE family_id IS NOT NULL;
CREATE UNIQUE INDEX collection_maps_map_unique_index ON collection_maps (collection_id, map_id)
  WHERE map_id IS NOT NULL;
CREATE INDEX collection_maps_position_index ON collection_maps (collection_id, position);
CREATE INDEX collection_maps_family_id_index ON collection_maps (family_id);
CREATE INDEX collection_maps_map_id_index ON collection_maps (map_id);

-- Players keeping someone else's collection in their own list.
CREATE TABLE collection_saves (
  user_id integer NOT NULL REFERENCES users (id),
  collection_id uuid NOT NULL REFERENCES collections (id) ON DELETE CASCADE,
  saved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, collection_id)
);

CREATE INDEX collection_saves_collection_id_index ON collection_saves (collection_id);

-- Players telling staff about a public collection. Staff resolve a report by dismissing it, or by
-- hiding the collection, which resolves every open report about it.
CREATE TABLE collection_reports (
  id uuid PRIMARY KEY DEFAULT sb_uuid(),
  collection_id uuid NOT NULL REFERENCES collections (id) ON DELETE CASCADE,
  reporter_id integer NOT NULL REFERENCES users (id),
  note text NOT NULL CHECK (char_length(note) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by integer REFERENCES users (id),
  resolution text CHECK (resolution IN ('dismissed', 'hidden')),
  CHECK ((resolved_at IS NULL) = (resolved_by IS NULL)),
  CHECK ((resolved_at IS NULL) = (resolution IS NULL))
);

-- One open report per reporter and collection: reporting again updates its note.
CREATE UNIQUE INDEX collection_reports_open_unique_index
  ON collection_reports (collection_id, reporter_id) WHERE resolved_at IS NULL;
CREATE INDEX collection_reports_open_index ON collection_reports (created_at, id)
  WHERE resolved_at IS NULL;
CREATE INDEX collection_reports_created_at_index ON collection_reports (created_at, id);

-- Every player with favorites gets a Starred collection holding them.
INSERT INTO collections (kind, owner_id, created_at, updated_at)
SELECT 'starred', favorited_by, COALESCE(min(favorited_date), now()),
  COALESCE(max(favorited_date), now())
FROM favorited_maps
GROUP BY favorited_by;

INSERT INTO collection_maps (collection_id, family_id, position, added_at)
SELECT c.id, f.family_id, 0, f.favorited_date
FROM favorited_maps f
INNER JOIN collections c ON c.owner_id = f.favorited_by AND c.kind = 'starred';

DROP TABLE favorited_maps;

-- `map_favorite_counts` counts the Starred collections each map is in. Its triggers move from
-- `favorited_maps` to `collection_maps`, counting only map entries of Starred collections.
-- Statement-level, so bulk changes update each map's count once. Inserts that don't add a row
-- (e.g. ON CONFLICT DO NOTHING) don't appear in the transition tables. A collection's kind never
-- changes, so an entry counts from when it's added until it's removed.
CREATE OR REPLACE FUNCTION update_map_favorite_counts() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'UPDATE' THEN
    UPDATE map_favorite_counts c
    SET favorites = c.favorites - r.removed
    FROM (
      SELECT e.family_id, count(*) AS removed
      FROM removed_entries e
      INNER JOIN collections col ON col.id = e.collection_id AND col.kind = 'starred'
      WHERE e.family_id IS NOT NULL
      GROUP BY e.family_id
    ) r
    WHERE c.family_id = r.family_id;
  END IF;

  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    INSERT INTO map_favorite_counts AS c (family_id, favorites)
    SELECT e.family_id, count(*)
    FROM added_entries e
    INNER JOIN collections col ON col.id = e.collection_id AND col.kind = 'starred'
    WHERE e.family_id IS NOT NULL
    GROUP BY e.family_id
    ON CONFLICT (family_id) DO UPDATE SET favorites = c.favorites + EXCLUDED.favorites;
  END IF;

  IF TG_OP = 'TRUNCATE' THEN
    DELETE FROM map_favorite_counts;
  END IF;

  RETURN NULL;
END;
$$;

CREATE TRIGGER map_favorite_counts_insert
  AFTER INSERT ON collection_maps
  REFERENCING NEW TABLE AS added_entries
  FOR EACH STATEMENT EXECUTE FUNCTION update_map_favorite_counts();

CREATE TRIGGER map_favorite_counts_delete
  AFTER DELETE ON collection_maps
  REFERENCING OLD TABLE AS removed_entries
  FOR EACH STATEMENT EXECUTE FUNCTION update_map_favorite_counts();

CREATE TRIGGER map_favorite_counts_update
  AFTER UPDATE ON collection_maps
  REFERENCING OLD TABLE AS removed_entries NEW TABLE AS added_entries
  FOR EACH STATEMENT EXECUTE FUNCTION update_map_favorite_counts();

CREATE TRIGGER map_favorite_counts_truncate
  AFTER TRUNCATE ON collection_maps
  FOR EACH STATEMENT EXECUTE FUNCTION update_map_favorite_counts();

-- The count triggers read an entry's collection to tell whether it's a Starred one, which a
-- deleted collection's cascaded entry deletes can no longer do. Deleting a Starred collection's
-- entries before the collection itself keeps its maps' counts right.
CREATE FUNCTION delete_starred_collection_maps() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM collection_maps WHERE collection_id = OLD.id;
  RETURN OLD;
END;
$$;

CREATE TRIGGER collections_delete_starred_maps
  BEFORE DELETE ON collections
  FOR EACH ROW WHEN (OLD.kind = 'starred')
  EXECUTE FUNCTION delete_starred_collection_maps();

-- Recount from the moved entries, which hold exactly the favorites that were counted.
DELETE FROM map_favorite_counts;
INSERT INTO map_favorite_counts (family_id, favorites)
SELECT cm.family_id, count(*)
FROM collection_maps cm
INNER JOIN collections c ON c.id = cm.collection_id AND c.kind = 'starred'
WHERE cm.family_id IS NOT NULL
GROUP BY cm.family_id;
