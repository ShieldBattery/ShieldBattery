-- The weekly feature slots: each week has one slot per kind of map (`kind`, 'melee' or 'ums', as in
-- `maps.kind`), and each slot holds at most one staff pick, of a map (`family_id`) or a collection
-- (`collection_id`). A map pick is in the slot of the kind its current file had when it was picked,
-- and is only shown while its current file is still of that kind; a collection pick is in whichever
-- slot staff put it, and the same collection can fill both slots of a week. `week` is the Monday
-- (UTC) the week starts; a week runs from that Monday 00:00 UTC to the next. When a map is merged
-- into another, its rows move to the map it was merged into. `notified_at` is when the pick's maker
-- was told about it, and is reset whenever the slot's pick changes to another map or collection. A
-- collection filling both slots of a week is announced once: a slot claimed for its announcement
-- after the other slot's announcement of the same collection takes that slot's `notified_at`.
ALTER TABLE map_features ADD COLUMN kind text, DROP CONSTRAINT map_features_pkey;

-- A map pick takes the kind of its map's current file. A map whose kind can't be found goes in the
-- melee slot, where it stays in the schedule for staff to see, and isn't shown unless its current
-- file is melee.
UPDATE map_features AS mf
SET kind = COALESCE(
  (
    SELECT cur.kind
    FROM map_families AS fam
    INNER JOIN maps AS cur ON cur.id = fam.current_map_id
    WHERE fam.id = mf.family_id AND cur.kind IN ('melee', 'ums')
  ),
  'melee'
)
WHERE mf.family_id IS NOT NULL;

-- A collection pick was shown for both kinds, so it fills both slots of its week
UPDATE map_features SET kind = 'melee' WHERE collection_id IS NOT NULL;

INSERT INTO map_features (
  week, kind, family_id, collection_id, blurb, created_by, created_at, updated_at, notified_at
)
SELECT week, 'ums', family_id, collection_id, blurb, created_by, created_at, updated_at, notified_at
FROM map_features
WHERE collection_id IS NOT NULL;

ALTER TABLE map_features
  ALTER COLUMN kind SET NOT NULL,
  ADD CONSTRAINT map_features_kind_check CHECK (kind IN ('melee', 'ums')),
  ADD PRIMARY KEY (week, kind);
