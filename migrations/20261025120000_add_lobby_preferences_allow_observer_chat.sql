-- Remembers whether a host wants observers to chat with players in-game.
--
-- Nullable with no default: an absent value means the user has never touched the control, and the
-- client applies the disabled default.

ALTER TABLE lobby_preferences
  ADD COLUMN allow_observer_chat boolean;
