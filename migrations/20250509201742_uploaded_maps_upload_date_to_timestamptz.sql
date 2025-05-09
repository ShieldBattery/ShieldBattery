-- By doing this we can migrate the table without locking it fully
SET timezone = 'UTC';

ALTER TABLE uploaded_maps
  ALTER COLUMN upload_date SET DATA TYPE timestamptz,
  ALTER COLUMN removed_at SET DATA TYPE timestamptz;

RESET timezone;

