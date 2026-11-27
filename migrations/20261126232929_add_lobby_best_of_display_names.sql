-- Remembers the display name a host last gave a player in a best-of series they started or changed,
-- so the next series that host puts the player in starts with it.
--
-- A row exists only while the host has a display name remembered for the player: clearing it
-- deletes the row. `used_at` is when the host last gave the name, and only a host's most recently
-- used names are kept, so the older rows of a host with many are deleted as newer ones are written.

CREATE TABLE lobby_best_of_display_names (
  host_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  player_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  used_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (host_id, player_id)
);
