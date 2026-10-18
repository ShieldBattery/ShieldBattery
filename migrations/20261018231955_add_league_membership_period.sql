ALTER TABLE league_users
  ADD COLUMN joined_at TIMESTAMPTZ NOT NULL DEFAULT '-infinity',
  ADD COLUMN left_at TIMESTAMPTZ;

ALTER TABLE league_users ALTER COLUMN joined_at SET DEFAULT clock_timestamp();
