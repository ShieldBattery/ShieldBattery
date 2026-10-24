-- Keep a typed, coalesced observation for consumers that may be offline when source rows expire.
-- IDs are identities, not commit-order cursors: consumers must compare each row's revision.
CREATE TABLE game_session_evidence_changes (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
  pending BOOLEAN NOT NULL DEFAULT TRUE,
  tenant TEXT NOT NULL,
  session BIGINT NOT NULL CHECK (session >= 0),
  slot SMALLINT NOT NULL CHECK (slot BETWEEN 0 AND 15),
  connection_id BYTEA NOT NULL CHECK (octet_length(connection_id) = 32),
  sample_id BIGINT NOT NULL CHECK (sample_id >= 0),
  game_id UUID NOT NULL,
  user_id INTEGER NOT NULL,
  received_at TIMESTAMPTZ NOT NULL,
  sequence BIGINT NOT NULL CHECK (sequence >= 0),
  assignment_revision BIGINT NOT NULL CHECK (assignment_revision >= 0),
  verdict TEXT NOT NULL CHECK (verdict IN ('missing', 'unknown_key', 'invalid', 'valid')),
  key_id BIGINT CHECK (key_id BETWEEN 0 AND 4294967295),
  body BYTEA NOT NULL CHECK (octet_length(body) <= 4028),
  interruption TEXT,
  historical BOOLEAN NOT NULL,
  failure_count BIGINT CHECK (failure_count BETWEEN 1 AND 4294967295),
  observed_at TIMESTAMPTZ,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK (verdict = 'valid' OR octet_length(body) = 0),
  CHECK (verdict <> 'valid' OR key_id IS NOT NULL),
  CHECK (sample_id <> 0 OR (
    interruption IS NULL AND NOT historical AND failure_count IS NULL AND observed_at IS NULL
  )),
  UNIQUE (tenant, session, slot, connection_id, sample_id)
);

-- A downstream processor acknowledges a matching (id, revision) in its work transaction.
-- Independent processors require separate subscriptions rather than sharing this acknowledgment.
CREATE INDEX game_session_evidence_changes_pending_index
  ON game_session_evidence_changes (id) WHERE pending;

CREATE INDEX game_session_evidence_changes_changed_at_index
  ON game_session_evidence_changes (changed_at, id);

CREATE FUNCTION record_game_session_evidence_change() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  sample BIGINT := 0;
  interruption_value TEXT;
  historical_value BOOLEAN := FALSE;
  failure_count_value BIGINT;
  observed_at_value TIMESTAMPTZ;
BEGIN
  IF TG_TABLE_NAME = 'game_session_periodic_evidence' THEN
    sample := NEW.sample_id;
    interruption_value := NEW.interruption;
    historical_value := NEW.historical;
    failure_count_value := NEW.failure_count;
    observed_at_value := NEW.observed_at;
  END IF;

  INSERT INTO game_session_evidence_changes AS changes (
    tenant, session, slot, connection_id, sample_id, game_id, user_id, received_at,
    sequence, assignment_revision, verdict, key_id, body, interruption, historical,
    failure_count, observed_at
  ) VALUES (
    NEW.tenant, NEW.session, NEW.slot, NEW.connection_id, sample, NEW.game_id, NEW.user_id,
    NEW.received_at, NEW.sequence, NEW.assignment_revision, NEW.verdict, NEW.key_id, NEW.body,
    interruption_value, historical_value, failure_count_value, observed_at_value
  )
  ON CONFLICT (tenant, session, slot, connection_id, sample_id) DO UPDATE SET
    game_id = EXCLUDED.game_id,
    user_id = EXCLUDED.user_id,
    received_at = EXCLUDED.received_at,
    sequence = EXCLUDED.sequence,
    assignment_revision = EXCLUDED.assignment_revision,
    verdict = EXCLUDED.verdict,
    key_id = EXCLUDED.key_id,
    body = EXCLUDED.body,
    interruption = EXCLUDED.interruption,
    historical = EXCLUDED.historical,
    failure_count = EXCLUDED.failure_count,
    observed_at = EXCLUDED.observed_at,
    revision = changes.revision + 1,
    pending = TRUE,
    changed_at = clock_timestamp()
  WHERE ROW(
    changes.game_id, changes.user_id, changes.received_at, changes.sequence,
    changes.assignment_revision, changes.verdict, changes.key_id, changes.body,
    changes.interruption, changes.historical, changes.failure_count, changes.observed_at
  ) IS DISTINCT FROM ROW(
    EXCLUDED.game_id, EXCLUDED.user_id, EXCLUDED.received_at, EXCLUDED.sequence,
    EXCLUDED.assignment_revision, EXCLUDED.verdict, EXCLUDED.key_id, EXCLUDED.body,
    EXCLUDED.interruption, EXCLUDED.historical, EXCLUDED.failure_count, EXCLUDED.observed_at
  );
  RETURN NEW;
END;
$$;

-- Hold both source locks until backfill and trigger installation commit together.
LOCK TABLE game_session_evidence, game_session_periodic_evidence IN SHARE ROW EXCLUSIVE MODE;

INSERT INTO game_session_evidence_changes (
  tenant, session, slot, connection_id, sample_id, game_id, user_id, received_at,
  sequence, assignment_revision, verdict, key_id, body, interruption, historical,
  failure_count, observed_at
)
SELECT tenant, session, slot, connection_id, 0, game_id, user_id, received_at,
  sequence, assignment_revision, verdict, key_id, body, NULL, FALSE, NULL, NULL
FROM game_session_evidence
UNION ALL
SELECT tenant, session, slot, connection_id, sample_id, game_id, user_id, received_at,
  sequence, assignment_revision, verdict, key_id, body, interruption, historical,
  failure_count, observed_at
FROM game_session_periodic_evidence;

CREATE TRIGGER game_session_evidence_insert_change
AFTER INSERT ON game_session_evidence
FOR EACH ROW EXECUTE FUNCTION record_game_session_evidence_change();
CREATE TRIGGER game_session_evidence_update_change
AFTER UPDATE ON game_session_evidence
FOR EACH ROW WHEN (OLD.* IS DISTINCT FROM NEW.*)
EXECUTE FUNCTION record_game_session_evidence_change();
CREATE TRIGGER game_session_periodic_evidence_insert_change
AFTER INSERT ON game_session_periodic_evidence
FOR EACH ROW EXECUTE FUNCTION record_game_session_evidence_change();
CREATE TRIGGER game_session_periodic_evidence_update_change
AFTER UPDATE ON game_session_periodic_evidence
FOR EACH ROW WHEN (OLD.* IS DISTINCT FROM NEW.*)
EXECUTE FUNCTION record_game_session_evidence_change();
