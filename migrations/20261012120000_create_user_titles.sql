-- Titles a user has unlocked (see `TITLES` in common/titles.ts, whose ids are stored in
-- `title_id`). A row is written once, when the title is earned or granted, and is permanent.
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
  PRIMARY KEY (user_id, title_id)
);

-- The title the user displays, or NULL for Novice. Only a title the user has unlocked can be
-- displayed.
ALTER TABLE users
  ADD COLUMN title text,
  ADD CONSTRAINT users_title_fkey FOREIGN KEY (id, title) REFERENCES user_titles (user_id, title_id);

-- Running counts of the things earned titles are checked against that no other table already counts,
-- so checking a user's titles never has to read through their games. `counters` maps a counter's
-- name (see `TitleCounter` in server/lib/titles/title-models.ts) to its count, and a counter that
-- isn't present counts as 0, so new counters can be added without changing this table.
--
-- Game counters are added to in the same transaction that applies a game's results, so each game is
-- counted once. A user's games from before their first title evaluation are counted by that
-- evaluation, which replaces their game counters with ones computed from their whole history.
CREATE TABLE user_title_tracking (
  user_id integer PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  counters jsonb NOT NULL DEFAULT '{}'
);

-- Adds each count in `increments` to the matching count in `counters` (starting from 0 for counts
-- `counters` doesn't have yet), leaving every other count as it is.
CREATE FUNCTION jsonb_add_counters(counters jsonb, increments jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT counters || COALESCE(
    (
      SELECT jsonb_object_agg(i.key, COALESCE((counters->>i.key)::numeric, 0) + i.value::numeric)
      FROM jsonb_each_text(increments) i
    ),
    '{}'::jsonb
  )
$$;
