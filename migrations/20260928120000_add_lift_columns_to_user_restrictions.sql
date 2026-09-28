-- Records an early lift of a restriction. `end_time` is moved to the lift time so every existing
-- "is this restriction active" check keeps working; these columns only preserve who lifted it and
-- why.
ALTER TABLE user_restrictions
  ADD COLUMN lifted_by int4 REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN lifted_at timestamptz,
  ADD COLUMN lift_reason text;
