-- Permission letting a trusted non-staff user (e.g. a map maker) work the map families review queue
-- for listed maps. Separate from `manage_maps` so it can be granted without any other map powers.
ALTER TABLE permissions ADD COLUMN review_map_families boolean NOT NULL DEFAULT false;
