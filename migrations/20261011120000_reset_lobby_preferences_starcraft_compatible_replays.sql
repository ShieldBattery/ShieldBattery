-- Lobbies now play without the replay-incompatible logic fixes unless the host opts in. The
-- create-lobby form saved `false` for nearly every host under the old default, which would now opt
-- them in without them choosing it, so every saved value is cleared to give all hosts the new
-- default.

UPDATE lobby_preferences
  SET starcraft_compatible_replays = NULL;
