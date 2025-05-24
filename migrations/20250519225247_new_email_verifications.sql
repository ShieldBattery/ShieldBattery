DROP TABLE email_verifications;

CREATE TABLE email_verifications (
    id uuid PRIMARY KEY DEFAULT sb_uuid(),
    user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email text NOT NULL,
    verification_code text NOT NULL,
    request_time timestamptz NOT NULL DEFAULT now(),
    request_ip inet NOT NULL,
    exhausted boolean NOT NULL DEFAULT false
);

CREATE UNIQUE INDEX email_verifications_user_id_verification_code_unique
  ON email_verifications (user_id, verification_code)
  WHERE NOT exhausted;
