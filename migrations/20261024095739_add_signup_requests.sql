CREATE TABLE signup_requests (
  id UUID PRIMARY KEY,
  nonce BYTEA NOT NULL CHECK (octet_length(nonce) = 32),
  request_hash BYTEA NOT NULL CHECK (octet_length(request_hash) = 32),
  expires_at TIMESTAMPTZ NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX signup_requests_expiry ON signup_requests (expires_at);
