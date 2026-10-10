-- Remembers the create-lobby form's event mode toggle (Battle.net-compatible replays), so a host
-- gets their last-used setting back instead of the default on every visit.
--
-- Nullable with no default: an absent value means the user has never touched the control, and the
-- client applies its own default (event mode off).

ALTER TABLE lobby_preferences
  ADD COLUMN starcraft_compatible_replays boolean;
