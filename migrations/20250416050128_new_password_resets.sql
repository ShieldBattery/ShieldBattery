DROP TABLE password_resets;

CREATE TABLE password_resets (
  id uuid PRIMARY KEY DEFAULT sb_uuid(),
  user_id integer REFERENCES users(id) ON DELETE CASCADE,
  reset_code text NOT NULL,
  request_time timestamptz NOT NULL DEFAULT now(),
  request_ip inet NOT NULL,
  exhausted boolean NOT NULL DEFAULT false
);

-- Ensure that reset_codes must be unique among non-exhausted rows
CREATE UNIQUE INDEX password_resets_unique_reset_code
  ON password_resets (reset_code)
  WHERE NOT exhausted;
