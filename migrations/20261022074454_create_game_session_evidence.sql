CREATE TABLE game_session_evidence (
  tenant TEXT NOT NULL,
  session BIGINT NOT NULL CHECK (session >= 0),
  slot SMALLINT NOT NULL CHECK (slot BETWEEN 0 AND 15),
  connection_id BYTEA NOT NULL CHECK (octet_length(connection_id) = 32),
  game_id UUID NOT NULL,
  user_id INTEGER NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sequence BIGINT NOT NULL CHECK (sequence >= 0),
  assignment_revision BIGINT NOT NULL CHECK (assignment_revision >= 0),
  verdict TEXT NOT NULL CHECK (verdict IN ('missing', 'unknown_key', 'invalid', 'valid')),
  key_id BIGINT CHECK (key_id BETWEEN 0 AND 4294967295),
  body BYTEA NOT NULL CHECK (octet_length(body) <= 4028),
  CHECK (verdict = 'valid' OR octet_length(body) = 0),
  CHECK (verdict <> 'valid' OR key_id IS NOT NULL),
  PRIMARY KEY (tenant, session, slot, connection_id)
);

CREATE INDEX game_session_evidence_game_id_index ON game_session_evidence (game_id);
CREATE INDEX game_session_evidence_received_at_index ON game_session_evidence (received_at);
