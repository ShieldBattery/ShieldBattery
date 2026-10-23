CREATE TABLE game_session_periodic_evidence (
  LIKE game_session_evidence INCLUDING DEFAULTS INCLUDING CONSTRAINTS,
  sample_id BIGINT NOT NULL CHECK (sample_id > 0),
  interruption TEXT CHECK (
    interruption IS NULL OR (
      interruption IN (
        'no_answer', 'timeout', 'connection_closed', 'connection_replaced',
        'slot_departed', 'revoked', 'session_retired', 'silent_slot',
        'desync_evicted', 'lagging_slot', 'lobby_violation', 'stream_closed'
      ) AND verdict = 'missing'
    )
  ),
  historical BOOLEAN NOT NULL DEFAULT FALSE,
  failure_count BIGINT CHECK (failure_count BETWEEN 1 AND 4294967295),
  observed_at TIMESTAMPTZ,
  PRIMARY KEY (tenant, session, slot, connection_id, sample_id)
);

CREATE INDEX game_session_periodic_evidence_game_id_index
  ON game_session_periodic_evidence (game_id);
CREATE INDEX game_session_periodic_evidence_received_at_index
  ON game_session_periodic_evidence (received_at);
