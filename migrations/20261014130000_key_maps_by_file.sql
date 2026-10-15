-- A map is identified by its file: one `maps` row per hash, with a stable `id` that every other
-- table references. `uploaded_maps` held one row per (uploader, visibility, file), so the same file
-- could have dozens of ids. Each file's `id` reuses one of its existing upload ids (preferring the
-- one matchmaking pools reference), so already-canonical references don't change; every other
-- upload id is kept in `map_id_aliases` and resolved wherever ids enter the API.

CREATE TEMPORARY TABLE map_canonical AS
WITH pool_refs AS (
  SELECT DISTINCT ON (um.map_hash) um.map_hash, um.id
  FROM matchmaking_map_pools AS p
  CROSS JOIN LATERAL unnest(p.maps) WITH ORDINALITY AS pm(map_id, pos)
  INNER JOIN uploaded_maps AS um ON um.id = pm.map_id
  ORDER BY um.map_hash, p.start_date DESC, p.id DESC, pm.pos
),
game_counts AS (
  SELECT map_id, count(*) AS games
  FROM games
  GROUP BY map_id
)
SELECT DISTINCT ON (um.map_hash) um.map_hash AS hash, um.id
FROM uploaded_maps AS um
LEFT JOIN pool_refs AS pr ON pr.id = um.id
LEFT JOIN game_counts AS gc ON gc.map_id = um.id
ORDER BY
  um.map_hash,
  (pr.id IS NOT NULL) DESC,
  (um.visibility = 'OFFICIAL' AND um.removed_at IS NULL) DESC,
  (um.visibility = 'PUBLIC' AND um.removed_at IS NULL) DESC,
  COALESCE(gc.games, 0) DESC,
  um.upload_date,
  um.id;

ALTER TABLE maps
  ADD COLUMN id uuid,
  ADD COLUMN public_name text,
  ADD COLUMN public_description text,
  ADD COLUMN listing map_visibility NOT NULL DEFAULT 'UNLISTED',
  ADD COLUMN published_by integer REFERENCES users (id),
  ADD COLUMN published_at timestamptz,
  ADD COLUMN delisted_by integer REFERENCES users (id),
  ADD COLUMN delisted_at timestamptz;

-- `published_by`/`published_at` record the most recent publishing and are kept when a map is
-- delisted, so a delisted map still shows who published it and when it was taken down.

UPDATE maps AS m
SET id = c.id
FROM map_canonical AS c
WHERE c.hash = m.hash;

UPDATE maps SET id = sb_uuid() WHERE id IS NULL;

ALTER TABLE maps
  ALTER COLUMN id SET NOT NULL,
  ALTER COLUMN id SET DEFAULT sb_uuid(),
  ADD CONSTRAINT maps_id_key UNIQUE (id);

-- The name shown everywhere: the curated name of a listed map, otherwise the file's own title.
ALTER TABLE maps
  ADD COLUMN name text GENERATED ALWAYS AS (COALESCE(public_name, title)) STORED;

CREATE INDEX maps_listing_index ON maps (listing);

-- A file is listed at the highest visibility any of its live uploads had.
UPDATE maps AS m
SET
  listing = v.visibility,
  published_by = v.uploaded_by,
  published_at = v.upload_date
FROM (
  SELECT DISTINCT ON (map_hash) map_hash, visibility, uploaded_by, upload_date
  FROM uploaded_maps
  WHERE removed_at IS NULL AND visibility IN ('OFFICIAL', 'PUBLIC')
  ORDER BY map_hash, (visibility = 'OFFICIAL') DESC, upload_date
) AS v
WHERE v.map_hash = m.hash;

-- Files whose listed uploads were all removed were delisted: keep who published them, and when the
-- last of those uploads was removed (who removed it wasn't recorded).
UPDATE maps AS m
SET
  published_by = v.uploaded_by,
  published_at = v.upload_date,
  delisted_at = v.removed_at
FROM (
  SELECT DISTINCT ON (map_hash) map_hash, uploaded_by, upload_date, removed_at
  FROM uploaded_maps
  WHERE visibility IN ('OFFICIAL', 'PUBLIC')
  ORDER BY map_hash, removed_at DESC, (visibility = 'OFFICIAL') DESC, upload_date DESC
) AS v
WHERE v.map_hash = m.hash AND m.listing = 'UNLISTED';

-- Curated names/descriptions come from the file's listed uploads, live ones first, so that games on
-- maps that have since been removed from the listings keep the names they were played under. They're
-- only stored when they differ from the file's own.
UPDATE maps AS m
SET
  public_name = NULLIF(v.name, m.title),
  public_description = NULLIF(v.description, m.description)
FROM (
  SELECT DISTINCT ON (map_hash) map_hash, name, description
  FROM uploaded_maps
  WHERE visibility IN ('OFFICIAL', 'PUBLIC')
  ORDER BY map_hash, (removed_at IS NULL) DESC, (visibility = 'OFFICIAL') DESC, upload_date DESC
) AS v
WHERE v.map_hash = m.hash;

CREATE TABLE map_id_aliases (
  old_id uuid PRIMARY KEY,
  map_id uuid NOT NULL REFERENCES maps (id)
);

INSERT INTO map_id_aliases (old_id, map_id)
SELECT um.id, m.id
FROM uploaded_maps AS um
INNER JOIN maps AS m ON m.hash = um.map_hash
WHERE um.id <> m.id;

-- A user's maps: every file they uploaded themselves and haven't removed. Official uploads are
-- staff publishing a map, not adding it to their own collection.
CREATE TABLE map_library (
  user_id integer NOT NULL REFERENCES users (id),
  map_id uuid NOT NULL REFERENCES maps (id),
  added_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, map_id)
);

INSERT INTO map_library (user_id, map_id, added_at)
SELECT um.uploaded_by, m.id, max(um.upload_date)
FROM uploaded_maps AS um
INNER JOIN maps AS m ON m.hash = um.map_hash
WHERE um.removed_at IS NULL AND um.visibility <> 'OFFICIAL'
GROUP BY um.uploaded_by, m.id;

-- Rewrites an array of map ids to canonical ids, dropping duplicates (keeping first positions).
-- Ids that don't resolve to anything are kept as-is; callers already filter those at use.
CREATE FUNCTION pg_temp.canonical_map_ids(ids uuid[]) RETURNS uuid[] AS $$
  SELECT COALESCE(array_agg(id ORDER BY first_pos), '{}')
  FROM (
    SELECT COALESCE(a.map_id, e.id) AS id, min(e.pos) AS first_pos
    FROM unnest(ids) WITH ORDINALITY AS e(id, pos)
    LEFT JOIN map_id_aliases AS a ON a.old_id = e.id
    GROUP BY 1
  ) AS s
$$ LANGUAGE sql STABLE;

UPDATE games AS g
SET map_id = a.map_id
FROM map_id_aliases AS a
WHERE a.old_id = g.map_id;

UPDATE matchmaking_map_pools
SET maps = pg_temp.canonical_map_ids(maps)
WHERE maps IS NOT NULL;

UPDATE matchmaking_preferences
SET map_selections = pg_temp.canonical_map_ids(map_selections);

UPDATE lobby_preferences AS lp
SET selected_map = a.map_id
FROM map_id_aliases AS a
WHERE a.old_id = lp.selected_map;

UPDATE lobby_preferences
SET recent_maps = pg_temp.canonical_map_ids(recent_maps)
WHERE recent_maps IS NOT NULL;

-- Favorites of several uploads of one file collapse into one favorite of the file.
CREATE TEMPORARY TABLE canonical_favorites AS
SELECT COALESCE(a.map_id, f.map_id) AS map_id, f.favorited_by, min(f.favorited_date) AS favorited_date
FROM favorited_maps AS f
LEFT JOIN map_id_aliases AS a ON a.old_id = f.map_id
GROUP BY 1, 2;

ALTER TABLE favorited_maps DROP CONSTRAINT favorited_maps_map_id_fkey;
DELETE FROM favorited_maps;
INSERT INTO favorited_maps (map_id, favorited_by, favorited_date)
SELECT map_id, favorited_by, favorited_date FROM canonical_favorites;
ALTER TABLE favorited_maps
  ADD CONSTRAINT favorited_maps_map_id_fkey FOREIGN KEY (map_id) REFERENCES maps (id);

DROP TABLE canonical_favorites;
DROP TABLE map_canonical;

-- Kept for one release in case anything needs the per-upload data, then dropped.
ALTER TABLE uploaded_maps RENAME TO uploaded_maps_legacy;
