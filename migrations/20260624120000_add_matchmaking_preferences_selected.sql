-- Adds a `selected` flag to matchmaking_preferences so the find-match page can remember which modes
-- a user wants to queue for across sessions/devices. We set it to the set of types in the user's
-- most recent search (see the matchmaking `find` endpoint), and seed the page's default mode
-- selection from it on connect. Constant-default add is a metadata-only change, so it's safe inside
-- the migration's implicit transaction.

ALTER TABLE matchmaking_preferences
  ADD COLUMN selected BOOLEAN NOT NULL DEFAULT false;
