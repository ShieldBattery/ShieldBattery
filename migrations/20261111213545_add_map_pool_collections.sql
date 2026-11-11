-- Staff picks: the one staff collection whose maps get the "Staff pick" badge. It replaces the
-- per-file `maps.official` flag; it starts out holding every map that had an official file.
ALTER TABLE collections
  ADD COLUMN grants_staff_pick boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT collections_staff_pick_kind_check CHECK (NOT grants_staff_pick OR kind = 'staff');

CREATE UNIQUE INDEX collections_staff_pick_unique_index ON collections (grants_staff_pick)
  WHERE grants_staff_pick;

INSERT INTO collections (kind, title, grants_staff_pick) VALUES ('staff', 'Staff picks', true);

INSERT INTO collection_maps (collection_id, family_id, position)
SELECT
  (SELECT id FROM collections WHERE grants_staff_pick),
  f.id,
  (row_number() OVER (ORDER BY cur.sort_name, f.id) - 1)::integer
FROM map_families f
INNER JOIN maps cur ON cur.id = f.current_map_id
WHERE EXISTS (SELECT 1 FROM maps m WHERE m.family_id = f.id AND m.official);

-- Whether a map (family) is in Staff picks, as a map or through one of its files.
CREATE FUNCTION map_family_is_staff_pick(family uuid) RETURNS boolean
  LANGUAGE sql STABLE AS $$
    SELECT EXISTS (
      SELECT 1
      FROM collection_maps cm
      INNER JOIN collections c ON c.id = cm.collection_id
      WHERE c.grants_staff_pick
        AND (cm.family_id = family OR cm.map_id IN (SELECT m.id FROM maps m WHERE m.family_id = family))
    )
  $$;

DROP INDEX maps_listed_index;
ALTER TABLE maps DROP COLUMN official;
-- Listings look up a map's listed files.
CREATE INDEX maps_listed_index ON maps (family_id) WHERE listed;

-- Every ladder map pool is a `ladder_pool` collection holding its exact files in pool order. The
-- collection is made with the pool and never edited; it starts when the pool does.
ALTER TABLE matchmaking_map_pools ADD COLUMN collection_id uuid;
UPDATE matchmaking_map_pools SET collection_id = sb_uuid();

INSERT INTO collections (id, kind, created_at, updated_at)
SELECT collection_id, 'ladder_pool', start_date AT TIME ZONE 'UTC', start_date AT TIME ZONE 'UTC'
FROM matchmaking_map_pools;

-- Ids that name no file, and repeats of an id within a pool, are left out.
DO $$
DECLARE
  total bigint;
  kept bigint;
BEGIN
  SELECT COALESCE(sum(cardinality(maps)), 0) INTO total FROM matchmaking_map_pools;

  INSERT INTO collection_maps (collection_id, map_id, position, added_at)
  SELECT k.collection_id, k.map_id,
    (row_number() OVER (PARTITION BY k.collection_id ORDER BY k.pos) - 1)::integer,
    k.added_at
  FROM (
    SELECT DISTINCT ON (p.id, e.map_id) p.collection_id, e.map_id, e.pos,
      p.start_date AT TIME ZONE 'UTC' AS added_at
    FROM matchmaking_map_pools p
    CROSS JOIN LATERAL unnest(p.maps) WITH ORDINALITY AS e(map_id, pos)
    WHERE EXISTS (SELECT 1 FROM maps m WHERE m.id = e.map_id)
    ORDER BY p.id, e.map_id, e.pos
  ) k;
  GET DIAGNOSTICS kept = ROW_COUNT;

  RAISE NOTICE 'ladder pool collections: skipped % map ids that name no file or repeat in a pool',
    total - kept;
END
$$;

ALTER TABLE matchmaking_map_pools
  ALTER COLUMN collection_id SET NOT NULL,
  ADD CONSTRAINT matchmaking_map_pools_collection_id_key UNIQUE (collection_id),
  ADD CONSTRAINT matchmaking_map_pools_collection_id_fkey
    FOREIGN KEY (collection_id) REFERENCES collections (id),
  DROP COLUMN maps;

CREATE INDEX matchmaking_map_pools_type_start_index
  ON matchmaking_map_pools (matchmaking_type, start_date);

-- A file in a ladder map pool, past or present, can't be deleted: deleting it would silently take
-- it out of the pool. Emptying the tables with TRUNCATE skips this.
CREATE FUNCTION refuse_deleting_ladder_pool_maps() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM collection_maps cm
    INNER JOIN collections c ON c.id = cm.collection_id AND c.kind = 'ladder_pool'
    WHERE cm.map_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'map % is in a ladder map pool, so it can''t be deleted', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER maps_refuse_deleting_ladder_pool_maps
  BEFORE DELETE ON maps
  FOR EACH ROW EXECUTE FUNCTION refuse_deleting_ladder_pool_maps();
