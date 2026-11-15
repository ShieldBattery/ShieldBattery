-- Map tags: words saying what kind of map a map (family) is, from a list staff manage. A tag's `id`
-- is fixed when it's created, and is what links and history hold; its `kind` is fixed too. `name`
-- is its English name, unique among the tags of its kind ignoring case, and `names` holds its names
-- in other languages, an object of locale code to name: a language without an entry shows the
-- English name. Every tag applies to a map only while the map's current file is of the tag's kind:
-- tags of the other kind are ignored, and dropped the next time someone edits the map's tags.
-- `position` is the order of the tags of a kind, counting from 0; its uniqueness is checked at
-- commit, so one transaction can rewrite every position of a kind. The list shows melee tags first,
-- then UMS tags.
--
-- `auto_rule` makes `refresh_map_family_derived_tags` give the tag to the maps the rule holds for:
-- `rich_minerals` or `ladder_pool` (see that function). Only melee tags have one, and at most one
-- tag has each rule.
CREATE TABLE map_tags (
  id text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('melee', 'ums')),
  position integer NOT NULL,
  name text NOT NULL,
  names jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(names) = 'object'),
  auto_rule text CHECK (auto_rule IN ('rich_minerals', 'ladder_pool')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT map_tags_position_key UNIQUE (kind, position) DEFERRABLE INITIALLY DEFERRED,
  CHECK (auto_rule IS NULL OR kind = 'melee')
);

CREATE UNIQUE INDEX map_tags_name_index ON map_tags (kind, lower(name));

CREATE UNIQUE INDEX map_tags_auto_rule_index ON map_tags (auto_rule);

-- The tags of each map. `source` says who set a tag, which decides who may take it off: `staff`
-- over `maker` (the map's owner) over `player` over `derived` (computed from the map's files by
-- `refresh_map_family_derived_tags`). `set_by` is the user who set it, NULL exactly for `derived`.
-- Rows go with their map when it's merged away, and with their tag when it's deleted.
CREATE TABLE map_family_tags (
  family_id uuid NOT NULL REFERENCES map_families (id) ON DELETE CASCADE,
  tag_id text NOT NULL REFERENCES map_tags (id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('derived', 'player', 'maker', 'staff')),
  set_by integer REFERENCES users (id),
  set_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (family_id, tag_id),
  CHECK ((source = 'derived') = (set_by IS NULL))
);

-- Listings filter maps by tag.
CREATE INDEX map_family_tags_tag_id_index ON map_family_tags (tag_id, family_id);

-- When someone last changed the map's tags. NULL while its tags are only ever derived: once a
-- person has edited them, derived tags are neither added nor removed anymore.
ALTER TABLE map_families ADD COLUMN tags_edited_at timestamptz;

-- `set_tags` records a change to a map's tags.
ALTER TABLE map_family_history
  DROP CONSTRAINT map_family_history_kind_check,
  ADD CONSTRAINT map_family_history_kind_check
    CHECK (kind IN ('move_file', 'merge', 'split', 'set_default', 'clear_default',
      'report_status', 'publish', 'unpublish', 'delist', 'relist', 'link', 'unlink', 'set_owner',
      'remove_owner', 'set_credit', 'set_tags'));

-- Makes the `derived` tags of the given maps whose tags nobody has edited match what their files
-- say, adding the missing ones and removing the ones that don't hold. Maps whose tags someone edited
-- are left alone. A derived tag holds for a map when the tag's `auto_rule` does:
--
-- `rich_minerals`: the map's current file is a melee map averaging more than 5,000 minerals per
-- mineral field.
-- `ladder_pool`: the map's current file is a melee map, and some file of it is in a ladder map pool.
--
-- The rules are independent, so a map can get both tags. A derived row of a tag without a rule
-- never holds.
CREATE FUNCTION refresh_map_family_derived_tags(ids uuid[]) RETURNS void
  LANGUAGE plpgsql AS $$
BEGIN
  PERFORM lock_map_families();

  WITH families AS (
    SELECT f.id, cur.kind,
      COALESCE(a.mineral_fields > 0 AND a.mineral_total > 5000 * a.mineral_fields::bigint, false)
        AS rich_minerals
    FROM map_families f
    INNER JOIN maps cur ON cur.id = f.current_map_id
    LEFT JOIN map_analysis a ON a.map_id = cur.id
    WHERE f.id = ANY(ids) AND f.tags_edited_at IS NULL
  ),
  derived AS (
    SELECT d.id AS family_id, t.id AS tag_id
    FROM families d
    INNER JOIN map_tags t ON t.auto_rule = 'rich_minerals'
    WHERE d.kind = 'melee' AND d.rich_minerals
    UNION ALL
    SELECT d.id, t.id
    FROM families d
    INNER JOIN map_tags t ON t.auto_rule = 'ladder_pool'
    WHERE d.kind = 'melee' AND EXISTS (
      SELECT 1
      FROM maps m
      INNER JOIN collection_maps cm ON cm.map_id = m.id
      INNER JOIN collections c ON c.id = cm.collection_id AND c.kind = 'ladder_pool'
      WHERE m.family_id = d.id
    )
  ),
  removed AS (
    DELETE FROM map_family_tags t
    USING families d
    WHERE t.family_id = d.id AND t.source = 'derived'
      AND NOT EXISTS (
        SELECT 1 FROM derived k WHERE k.family_id = t.family_id AND k.tag_id = t.tag_id
      )
  )
  INSERT INTO map_family_tags (family_id, tag_id, source)
  SELECT family_id, tag_id, 'derived' FROM derived
  ON CONFLICT (family_id, tag_id) DO NOTHING;
END;
$$;

-- Recomputes the current file and the `listed` flag of the given families, then their derived tags
-- (which depend on the current file). A family's current file is its default pick while that is
-- eligible: a member of the family that is listed, or any member when none is listed. Otherwise it's
-- derived from the eligible members: the most games in the last 28 days, then the most games ever,
-- then the newest.
--
-- A derived current file only gives way to a more played one when that one leads it by at least 25%
-- and 10 games in the last 28 days, so files played about equally don't keep swapping places. With
-- `keep_current` false, the derived file is picked without that margin (e.g. right after staff
-- clear their pick). A current file that stopped being eligible is always replaced.
CREATE OR REPLACE FUNCTION refresh_map_families(ids uuid[], keep_current boolean DEFAULT true)
  RETURNS void
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

  PERFORM refresh_map_family_derived_tags(ids);
END;
$$;
