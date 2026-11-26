-- Remembers the caster overlay a host last started or saved a best-of series with (its two text
-- lines and its logo), so their next series starts with the same ones.
--
-- A row exists once the user has started a series. Each line is NULL when it isn't set, and the
-- logo's stored path and the name of the file it was uploaded from are both set or both NULL. The
-- stored file belongs to this row: it is deleted when the row stops pointing at it.

CREATE TABLE lobby_best_of_overlays (
  user_id INTEGER PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  line1 TEXT,
  line2 TEXT,
  logo_path TEXT,
  logo_file_name TEXT,
  CHECK ((logo_path IS NULL) = (logo_file_name IS NULL))
);
