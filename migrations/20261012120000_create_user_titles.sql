-- Titles a user has unlocked (see `TITLES` in common/titles.ts, whose ids are stored in
-- `title_id`). A row is written once, when the title is earned or granted, and is never recomputed;
-- earned titles are permanent, while granted ones are removed when an admin revokes them.
--
-- The `novice` row doubles as a marker that the user's titles have been evaluated at least once, so
-- the first evaluation can award a player's existing history silently instead of notifying them
-- about each title individually.
CREATE TYPE title_source AS ENUM ('earned', 'granted');

CREATE TABLE user_titles (
  user_id integer NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title_id text NOT NULL,
  unlocked_at timestamptz NOT NULL DEFAULT now(),
  source title_source NOT NULL,
  -- The admin who granted the title, for `granted` titles.
  granted_by integer REFERENCES users (id) ON DELETE SET NULL,
  -- Whether this is the title the user displays. At most one per user (enforced below); a user with
  -- no equipped title displays Novice.
  equipped boolean NOT NULL DEFAULT false,
  PRIMARY KEY (user_id, title_id)
);

CREATE UNIQUE INDEX user_titles_equipped_idx ON user_titles (user_id) WHERE equipped;
