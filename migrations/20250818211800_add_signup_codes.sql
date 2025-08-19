ALTER TABLE permissions
ADD COLUMN manage_signup_codes BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE user_signup_codes(
  id uuid PRIMARY KEY DEFAULT sb_uuid(),
  code text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by integer REFERENCES users(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  max_uses integer,
  uses integer NOT NULL DEFAULT 0,
  exhausted boolean NOT NULL DEFAULT false
);

CREATE UNIQUE INDEX user_signup_codes_code_key
  ON user_signup_codes(code)
  WHERE NOT exhausted;

CREATE INDEX user_signup_codes_expires_at_idx
  ON user_signup_codes(expires_at DESC);
