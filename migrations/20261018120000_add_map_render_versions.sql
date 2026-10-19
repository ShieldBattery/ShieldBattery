ALTER TABLE maps
  -- The render version (`MAP_RENDER_VERSION`) that produced the map's current images. 0 means the
  -- images predate render versions: they're stored at the legacy paths (`{hash}-{size}.jpg`, with
  -- `image_version` as a cache-busting query) and have start locations drawn in. Other versions
  -- store each render as a new generation, `image_version`, in its own paths.
  ADD COLUMN render_version integer NOT NULL DEFAULT 0,
  -- Whether the current images are zero-asset minimaps, rendered while no render assets were
  -- available. They're replaced once assets are.
  ADD COLUMN render_fallback boolean NOT NULL DEFAULT false,
  -- The last render version that failed to render this file, and why. A file isn't retried until
  -- the render version changes again.
  ADD COLUMN render_failed_version integer,
  ADD COLUMN render_error text;

-- Map image generations replaced by a newer render. Their files are kept for a while, so clients
-- holding the old URLs can still load them, then deleted.
CREATE TABLE superseded_map_images (
  hash bytea NOT NULL,
  image_version integer NOT NULL,
  -- The render version of the superseded images, which determines their paths.
  render_version integer NOT NULL,
  superseded_at timestamptz NOT NULL,
  PRIMARY KEY (hash, image_version)
);

CREATE INDEX superseded_map_images_superseded_at_index ON superseded_map_images (superseded_at);
