-- The cause of an automatic ban or warning. NULL for bans that weren't for a failed match start.
ALTER TABLE matchmaking_bans ADD COLUMN reason TEXT;
