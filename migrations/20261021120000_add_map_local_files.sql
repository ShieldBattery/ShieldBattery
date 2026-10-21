-- The app installs each user has synced the contents of their map folders from. An install that
-- hasn't synced in a while is deleted along with its files, so an uninstalled or abandoned app
-- doesn't keep stale maps in that user's "on this PC" listing.
CREATE TABLE map_local_installs (
  user_id integer NOT NULL REFERENCES users (id),
  install_id text NOT NULL,
  synced_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, install_id)
);

CREATE INDEX map_local_installs_synced_at_index ON map_local_installs (synced_at);

-- The known maps in each install's map folders. `folder` is the file's folder relative to one of
-- the app's map roots, prefixed with that root's key (e.g. `documents/Download/UMS`), never an
-- absolute path. Files whose hash matches no map aren't stored. One map can sit in several folders.
CREATE TABLE map_local_files (
  user_id integer NOT NULL,
  install_id text NOT NULL,
  map_id uuid NOT NULL REFERENCES maps (id),
  folder text NOT NULL,
  PRIMARY KEY (user_id, install_id, map_id, folder),
  FOREIGN KEY (user_id, install_id) REFERENCES map_local_installs (user_id, install_id)
    ON DELETE CASCADE
);
