-- Remembers the create-lobby form's "lock alliances" toggle, so a host gets their last-used setting
-- back instead of the default on every visit.
--
-- Nullable with no default: an absent value means the user has never touched the control, and the
-- client applies its own default (alliances unlocked).

ALTER TABLE lobby_preferences
  ADD COLUMN locked_alliances boolean;
