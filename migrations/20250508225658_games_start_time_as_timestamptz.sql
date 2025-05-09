
-- By doing this we can migrate the table without locking it fully
SET timezone = 'UTC';

ALTER TABLE games
  ALTER COLUMN start_time SET DATA TYPE timestamptz;

RESET timezone;
