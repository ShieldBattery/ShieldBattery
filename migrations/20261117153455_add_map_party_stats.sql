-- How many people play a map together. A game's humans are its `games_users` rows (computers and
-- observers have none).
ALTER TABLE map_stats
  -- Games in the last 28 days with exactly one human.
  ADD COLUMN solo_games_28d integer NOT NULL DEFAULT 0,
  -- Different users who played those games.
  ADD COLUMN solo_players_28d integer NOT NULL DEFAULT 0,
  -- The median number of humans in the games of the last 90 days that had two or more. NULL when
  -- fewer than 5 such games.
  ADD COLUMN party_size_90d integer;

-- The same columns, over every file of the family.
ALTER TABLE map_family_stats
  -- Games in the last 28 days with exactly one human.
  ADD COLUMN solo_games_28d integer NOT NULL DEFAULT 0,
  -- Different users who played those games.
  ADD COLUMN solo_players_28d integer NOT NULL DEFAULT 0,
  -- The median number of humans in the games of the last 90 days that had two or more. NULL when
  -- fewer than 5 such games.
  ADD COLUMN party_size_90d integer;
