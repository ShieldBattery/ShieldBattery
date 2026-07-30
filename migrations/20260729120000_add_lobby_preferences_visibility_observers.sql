-- Remembers the create-lobby form's visibility ('listed'/'unlisted') and observer toggle, so a host
-- gets their last-used settings back instead of the defaults on every visit.
--
-- Both nullable with no default: an absent value means the user has never touched the control, and
-- the client applies its own default ('listed' / observers allowed).

ALTER TABLE lobby_preferences
  ADD COLUMN visibility text CHECK (visibility IN ('listed', 'unlisted')),
  ADD COLUMN allow_observers boolean;
