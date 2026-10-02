-- User-uploaded maps are only left out of the browse listings; anyone with a map's id can still
-- view, download, favorite and play it, so the visibility is unlisted rather than private.
ALTER TYPE map_visibility RENAME VALUE 'PRIVATE' TO 'UNLISTED';
