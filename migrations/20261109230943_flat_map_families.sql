-- Maps as players know them ("Fighting Spirit"), each made of one or more map files. Every file
-- (`maps` row) belongs to exactly one family (`map_families` row), and a family always holds at
-- least one file. Membership is flat: files are binned into families, with no relations between
-- them. Each family has one current file, the one players get when they pick the map.

-- When the file first showed up on ShieldBattery: the "newest" tiebreak when picking a family's
-- current file. Backfilled from the earliest trace of the file.
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

-- SHA-256 of the file's `scenario.chk`: files that differ only in MPQ packing share it, and an
-- unlisted file alone in its family joins the family of another file with the same scenario. NULL
-- until the file is parsed by parser version 4 or later.
ALTER TABLE map_analysis ADD COLUMN chk_hash bytea;

CREATE INDEX map_analysis_chk_hash_index ON map_analysis (chk_hash);

CREATE TABLE map_families (
  id uuid PRIMARY KEY DEFAULT sb_uuid(),
  -- The file staff picked as the family's default. NULL when the default is derived. A pick that
  -- stops being eligible (it left the family, or it's unlisted while another file is listed) stays
  -- stored but is skipped until it's eligible again.
  default_map_id uuid REFERENCES maps (id) ON DELETE SET NULL,
  default_set_by integer REFERENCES users (id),
  default_set_at timestamptz,
  -- The file players get: `default_map_id` while it's eligible, otherwise derived. Maintained by
  -- `refresh_map_families`. Never NULL.
  current_map_id uuid NOT NULL REFERENCES maps (id),
  -- Whether any file of the family is listed. Maintained by `refresh_map_families`.
  listed boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX map_families_listed_index ON map_families (current_map_id) WHERE listed;

-- Every existing file starts in a family of its own.
ALTER TABLE maps ADD COLUMN family_id uuid;

UPDATE maps SET family_id = sb_uuid();

INSERT INTO map_families (id, current_map_id, listed, created_at, updated_at)
SELECT family_id, id, listed, first_seen_at, now()
FROM maps;

-- A family and its first file are inserted in one transaction, each referencing the other, so this
-- side of the reference is only checked at commit.
ALTER TABLE maps
  ALTER COLUMN family_id SET NOT NULL,
  ADD CONSTRAINT maps_family_id_fkey FOREIGN KEY (family_id) REFERENCES map_families (id)
    DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX maps_family_id_index ON maps (family_id);

-- The ids of families that were merged into another one, so links to them keep working. Aliases
-- always point at a family that exists: merging a family moves the aliases pointing at it along.
CREATE TABLE map_family_aliases (
  old_id uuid PRIMARY KEY,
  family_id uuid NOT NULL REFERENCES map_families (id) ON DELETE CASCADE
);

CREATE INDEX map_family_aliases_family_id_index ON map_family_aliases (family_id);

-- Taken by every transaction that changes which family a file is in, a family's default, or whether
-- a file is listed, before it changes anything, so concurrent writers can't derive a family's
-- current file from a membership another writer is changing.
CREATE FUNCTION lock_map_families() RETURNS void
  LANGUAGE sql AS $$
    SELECT pg_advisory_xact_lock(5999442596525916493);
  $$;

-- Recomputes the current file and the `listed` flag of the given families. A family's current file
-- is its default pick while that is eligible: a member of the family that is listed, or any member
-- when none is listed. Otherwise it's derived from the eligible members: the most games in the last
-- 28 days, then the most games ever, then the newest.
--
-- A derived current file only gives way to a more played one when that one leads it by at least 25%
-- and 10 games in the last 28 days, so files played about equally don't keep swapping places. With
-- `keep_current` false, the derived file is picked without that margin (e.g. right after staff
-- clear their pick). A current file that stopped being eligible is always replaced.
CREATE FUNCTION refresh_map_families(ids uuid[], keep_current boolean DEFAULT true) RETURNS void
  LANGUAGE plpgsql AS $$
BEGIN
  PERFORM lock_map_families();

  WITH members AS (
    SELECT m.family_id, m.id, m.listed, m.first_seen_at,
      COALESCE(s.games_28d, 0) AS games_28d,
      COALESCE(s.games_total, 0) AS games_total,
      bool_or(m.listed) OVER (PARTITION BY m.family_id) AS family_listed
    FROM maps m
    LEFT JOIN map_stats s ON s.map_id = m.id
    WHERE m.family_id = ANY(ids)
  ),
  eligible AS (
    SELECT * FROM members WHERE listed OR NOT family_listed
  ),
  derived AS (
    SELECT DISTINCT ON (family_id) family_id, id, games_28d, family_listed
    FROM eligible
    ORDER BY family_id, games_28d DESC, games_total DESC, first_seen_at DESC, id
  ),
  picked AS (
    SELECT d.family_id, d.family_listed,
      CASE
        WHEN pick.id IS NOT NULL THEN pick.id
        WHEN keep_current AND incumbent.id IS NOT NULL
          AND NOT (
            d.games_28d >= incumbent.games_28d * 1.25
            AND d.games_28d - incumbent.games_28d >= 10
          )
          THEN incumbent.id
        ELSE d.id
      END AS current_map_id
    FROM derived d
    INNER JOIN map_families f ON f.id = d.family_id
    LEFT JOIN eligible pick ON pick.family_id = f.id AND pick.id = f.default_map_id
    LEFT JOIN eligible incumbent ON incumbent.family_id = f.id AND incumbent.id = f.current_map_id
  )
  UPDATE map_families f
  SET current_map_id = p.current_map_id, listed = p.family_listed, updated_at = now()
  FROM picked p
  WHERE f.id = p.family_id
    AND (f.current_map_id, f.listed) IS DISTINCT FROM (p.current_map_id, p.family_listed);
END;
$$;

-- Play statistics summed over every file of a family, the same columns as `map_stats`. Rebuilt with
-- `map_stats`, and only for families of more than one file that have been played: other families
-- read their current file's `map_stats` row.
CREATE TABLE map_family_stats (
  family_id uuid PRIMARY KEY REFERENCES map_families (id) ON DELETE CASCADE,
  games_7d integer NOT NULL,
  games_28d integer NOT NULL,
  games_90d integer NOT NULL,
  players_90d integer NOT NULL,
  games_total integer NOT NULL,
  median_length_90d integer,
  last_played_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  lobby_games_7d integer NOT NULL,
  lobby_games_28d integer NOT NULL,
  lobby_players_7d integer NOT NULL,
  -- The same formula as `map_stats.trending_score`.
  trending_score integer NOT NULL GENERATED ALWAYS AS
    (CASE
      WHEN lobby_players_7d >= 5 THEN
        greatest(0, round(
          100 * (lobby_games_7d - greatest(lobby_games_28d - lobby_games_7d, 0) / 3.0) /
            sqrt(greatest(lobby_games_28d - lobby_games_7d, 0) / 3.0 + 5)
        ))::integer
      ELSE 0
    END) STORED
);

-- A favorite is of a family, so hosting a favorite gets its current file. Favorites of files
-- become favorites of their families, one per user and family, keeping the earliest date.
CREATE TEMPORARY TABLE family_favorites AS
SELECT m.family_id, f.favorited_by, min(f.favorited_date) AS favorited_date
FROM favorited_maps AS f
INNER JOIN maps AS m ON m.id = f.map_id
GROUP BY m.family_id, f.favorited_by;

DROP TRIGGER map_favorite_counts_insert ON favorited_maps;
DROP TRIGGER map_favorite_counts_delete ON favorited_maps;
DROP TRIGGER map_favorite_counts_update ON favorited_maps;
DROP TRIGGER map_favorite_counts_truncate ON favorited_maps;
DROP FUNCTION update_map_favorite_counts();
DROP TABLE map_favorite_counts;

ALTER TABLE favorited_maps DROP CONSTRAINT favorited_maps_map_id_fkey;
DELETE FROM favorited_maps;
ALTER TABLE favorited_maps RENAME COLUMN map_id TO family_id;
-- Not cascading: a family is only deleted by merging it into another, which moves its favorites
-- first.
ALTER TABLE favorited_maps
  ADD CONSTRAINT favorited_maps_family_id_fkey FOREIGN KEY (family_id) REFERENCES map_families (id);

INSERT INTO favorited_maps (family_id, favorited_by, favorited_date)
SELECT family_id, favorited_by, favorited_date FROM family_favorites;

DROP TABLE family_favorites;

-- How many users have favorited each family, kept up to date by triggers on `favorited_maps`.
-- Families without a row have no favorites.
CREATE TABLE map_favorite_counts (
  family_id uuid PRIMARY KEY REFERENCES map_families (id) ON DELETE CASCADE,
  favorites integer NOT NULL CHECK (favorites >= 0)
);

-- Statement-level, so bulk changes to `favorited_maps` update each family's count once. Inserts
-- that don't add a row (e.g. ON CONFLICT DO NOTHING) don't appear in the transition tables.
CREATE FUNCTION update_map_favorite_counts() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'UPDATE' THEN
    UPDATE map_favorite_counts c
    SET favorites = c.favorites - r.removed
    FROM (SELECT family_id, count(*) AS removed FROM removed_favorites GROUP BY family_id) r
    WHERE c.family_id = r.family_id;
  END IF;

  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    INSERT INTO map_favorite_counts AS c (family_id, favorites)
    SELECT family_id, count(*) FROM added_favorites GROUP BY family_id
    ON CONFLICT (family_id) DO UPDATE SET favorites = c.favorites + EXCLUDED.favorites;
  END IF;

  IF TG_OP = 'TRUNCATE' THEN
    DELETE FROM map_favorite_counts;
  END IF;

  RETURN NULL;
END;
$$;

CREATE TRIGGER map_favorite_counts_insert
  AFTER INSERT ON favorited_maps
  REFERENCING NEW TABLE AS added_favorites
  FOR EACH STATEMENT EXECUTE FUNCTION update_map_favorite_counts();

CREATE TRIGGER map_favorite_counts_delete
  AFTER DELETE ON favorited_maps
  REFERENCING OLD TABLE AS removed_favorites
  FOR EACH STATEMENT EXECUTE FUNCTION update_map_favorite_counts();

CREATE TRIGGER map_favorite_counts_update
  AFTER UPDATE ON favorited_maps
  REFERENCING OLD TABLE AS removed_favorites NEW TABLE AS added_favorites
  FOR EACH STATEMENT EXECUTE FUNCTION update_map_favorite_counts();

CREATE TRIGGER map_favorite_counts_truncate
  AFTER TRUNCATE ON favorited_maps
  FOR EACH STATEMENT EXECUTE FUNCTION update_map_favorite_counts();

INSERT INTO map_favorite_counts (family_id, favorites)
SELECT family_id, count(*) FROM favorited_maps GROUP BY family_id;

-- Users telling staff that a file isn't part of the map it's in (`wrong_map`), or that a map is the
-- same as another one (`same_map`). Reports change nothing by themselves. Family ids aren't foreign
-- keys, since families can be merged away; they're read through `map_family_aliases`.
CREATE TABLE map_family_reports (
  id uuid PRIMARY KEY DEFAULT sb_uuid(),
  kind text NOT NULL CHECK (kind IN ('wrong_map', 'same_map')),
  -- The family the report is about: the family the file was in when it was reported, or the map
  -- said to be the same as `other_family_id`.
  family_id uuid NOT NULL,
  -- The file said not to be part of `family_id`. Only for `wrong_map`.
  map_id uuid REFERENCES maps (id) ON DELETE CASCADE,
  -- The map said to be the same as `family_id`. Only for `same_map`.
  other_family_id uuid,
  note text,
  reported_by integer NOT NULL REFERENCES users (id),
  reported_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  resolved_by integer REFERENCES users (id),
  resolved_at timestamptz,
  CHECK ((kind = 'wrong_map') = (map_id IS NOT NULL)),
  CHECK ((kind = 'same_map') = (other_family_id IS NOT NULL)),
  CHECK (other_family_id IS DISTINCT FROM family_id)
);

CREATE INDEX map_family_reports_status_index ON map_family_reports (status, reported_at, id);
CREATE INDEX map_family_reports_family_id_index ON map_family_reports (family_id);
CREATE INDEX map_family_reports_other_family_id_index ON map_family_reports (other_family_id)
  WHERE other_family_id IS NOT NULL;
CREATE INDEX map_family_reports_map_id_index ON map_family_reports (map_id)
  WHERE map_id IS NOT NULL;
-- One open report per reporter and subject, so repeating a report doesn't pile up rows.
CREATE UNIQUE INDEX map_family_reports_open_unique_index
  ON map_family_reports (reported_by, kind, family_id, COALESCE(map_id, other_family_id))
  WHERE status = 'open';

-- Every change staff make to families and family reports, one row per action. Family ids aren't
-- foreign keys: the record outlives families that were merged away.
CREATE TABLE map_family_history (
  id uuid PRIMARY KEY DEFAULT sb_uuid(),
  kind text NOT NULL CHECK (kind IN ('move_file', 'merge', 'split', 'set_default',
    'clear_default', 'report_status')),
  actor integer NOT NULL REFERENCES users (id),
  -- The family acted on: where a file moved or a family was merged to, the new family of a split,
  -- the family whose default changed, or the family a report is about.
  family_id uuid NOT NULL,
  -- The family a file left (for a move or split), the family merged away, or the other map of a
  -- `same_map` report.
  other_family_id uuid,
  -- The file that moved, was split out or was made the default, or the file of a `wrong_map`
  -- report.
  map_id uuid REFERENCES maps (id) ON DELETE CASCADE,
  -- What changed: `files` (each moved file's family before and after), `defaults` (each changed
  -- default pick before and after), and `reportId` with `reportStatus` (before and after).
  details jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX map_family_history_created_at_index ON map_family_history (created_at DESC, id);
CREATE INDEX map_family_history_family_index ON map_family_history (family_id, created_at DESC);
CREATE INDEX map_family_history_other_family_index
  ON map_family_history (other_family_id, created_at DESC)
  WHERE other_family_id IS NOT NULL;
CREATE INDEX map_family_history_map_index ON map_family_history (map_id, created_at DESC)
  WHERE map_id IS NOT NULL;
CREATE INDEX map_family_history_actor_index ON map_family_history (actor, created_at DESC);
