-- Snapshot each participant's authorized client mode with its observations and retained changes.
ALTER TABLE game_session_evidence
  ADD COLUMN development_client BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE game_session_periodic_evidence
  ADD COLUMN development_client BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE game_session_evidence_changes
  ADD COLUMN development_client BOOLEAN NOT NULL DEFAULT FALSE;

CREATE OR REPLACE FUNCTION record_game_session_evidence_change() RETURNS TRIGGER
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
    failure_count, observed_at, development_client
  ) VALUES (
    NEW.tenant, NEW.session, NEW.slot, NEW.connection_id, sample, NEW.game_id, NEW.user_id,
    NEW.received_at, NEW.sequence, NEW.assignment_revision, NEW.verdict, NEW.key_id, NEW.body,
    interruption_value, historical_value, failure_count_value, observed_at_value, NEW.development_client
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
    development_client = EXCLUDED.development_client,
    revision = changes.revision + 1,
    pending = TRUE,
    changed_at = clock_timestamp()
  WHERE ROW(
    changes.game_id, changes.user_id, changes.received_at, changes.sequence,
    changes.assignment_revision, changes.verdict, changes.key_id, changes.body,
    changes.interruption, changes.historical, changes.failure_count, changes.observed_at,
    changes.development_client
  ) IS DISTINCT FROM ROW(
    EXCLUDED.game_id, EXCLUDED.user_id, EXCLUDED.received_at, EXCLUDED.sequence,
    EXCLUDED.assignment_revision, EXCLUDED.verdict, EXCLUDED.key_id, EXCLUDED.body,
    EXCLUDED.interruption, EXCLUDED.historical, EXCLUDED.failure_count, EXCLUDED.observed_at,
    EXCLUDED.development_client
  );
  RETURN NEW;
END;
$$;
