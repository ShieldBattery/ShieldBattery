-- Maps with no start locations and no active UMS force slots can't seat players in any game
-- mode, and the player-count filters in every map listing have no zero-player bucket, so these
-- uploads are invisible everywhere in the UI. Uploads of such maps are rejected at upload time;
-- this removes the ones that were uploaded before that check existed, using the same soft-delete
-- the user-facing map removal uses.
UPDATE uploaded_maps
SET removed_at = CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
WHERE removed_at IS NULL
  AND map_hash IN (
    SELECT hash
    FROM maps
    WHERE players_melee = 0 AND players_ums = 0
  );
