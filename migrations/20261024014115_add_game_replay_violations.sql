CREATE TABLE game_replay_violations (
  game_id UUID NOT NULL,
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind <> ''),
  details JSONB NOT NULL,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  next_recovery_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Completion refers to result protection/refunds, not account-ban enforcement.
  handled_at TIMESTAMPTZ,
  PRIMARY KEY (game_id, user_id, kind),
  FOREIGN KEY (user_id, game_id) REFERENCES games_users (user_id, game_id) ON DELETE CASCADE,
  CONSTRAINT game_replay_violations_details_kind_check CHECK (COALESCE(
    jsonb_typeof(details) = 'object'
      AND jsonb_typeof(details->'kind') = 'string'
      AND details->>'kind' = kind,
    FALSE
  )),
  CONSTRAINT game_replay_violations_seed_details_check CHECK (
    CASE WHEN kind = 'seedMismatch' THEN
      CASE WHEN jsonb_typeof(details->'expectedSeed') = 'number'
        AND jsonb_typeof(details->'actualSeed') = 'number' THEN
        (details->>'expectedSeed')::NUMERIC BETWEEN 0 AND 4294967295
        AND (details->>'actualSeed')::NUMERIC BETWEEN 0 AND 4294967295
        AND trunc((details->>'expectedSeed')::NUMERIC) = (details->>'expectedSeed')::NUMERIC
        AND trunc((details->>'actualSeed')::NUMERIC) = (details->>'actualSeed')::NUMERIC
        AND (details->>'expectedSeed')::NUMERIC <> (details->>'actualSeed')::NUMERIC
      ELSE FALSE END
    ELSE TRUE END
  )
);

CREATE INDEX game_replay_violations_pending ON game_replay_violations (next_recovery_at, game_id)
  WHERE handled_at IS NULL;
