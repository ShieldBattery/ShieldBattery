-- By doing this we can migrate the table without locking it fully. Not really important for a table
-- this small but it will be a good example for whatever larger tables we want to do this to (chat?)
set timezone = 'UTC';

ALTER TABLE leagues
  ALTER COLUMN signups_after SET DATA TYPE timestamptz,
  ALTER COLUMN start_at SET DATA TYPE timestamptz,
  ALTER COLUMN end_at SET DATA TYPE timestamptz;

RESET timezone;
