-- Records an early lift of a ban. `end_time` is moved to the lift time so every existing
-- "is this ban active" check keeps working; these columns only preserve who lifted it and why.
ALTER TABLE user_bans
  ADD COLUMN unbanned_by integer,
  ADD COLUMN unbanned_at timestamptz,
  ADD COLUMN unban_reason text;
