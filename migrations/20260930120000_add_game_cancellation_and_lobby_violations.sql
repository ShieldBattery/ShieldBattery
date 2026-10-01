-- Retains games that end during loading so cancellation is observable without treating them as
-- normal completed games. `gameAnomaly` additionally has durable per-game evidence below.
ALTER TABLE games
  ADD COLUMN canceled_at TIMESTAMPTZ NULL,
  ADD COLUMN cancellation_reason TEXT NULL,
  ADD COLUMN setup_resolution_final BOOLEAN NOT NULL DEFAULT FALSE,
  ADD CONSTRAINT games_cancellation_reason_check CHECK (
    cancellation_reason IS NULL
    OR cancellation_reason IN ('canceled', 'internal', 'playerFailed', 'timeout', 'gameAnomaly')
  ),
  ADD CONSTRAINT games_cancellation_fields_check CHECK (
    (canceled_at IS NULL) = (cancellation_reason IS NULL)
  );

-- A game can have only one penalized lobby-policy violation. The primary key makes retries
-- idempotent and preserves the first observed offender and timestamp as the audit evidence.
-- `identifiers` are the offender's client identifiers as known when the violation was staged
-- (`ClientIdentifierString` pairs), kept so the eventual ban covers them even if that client has
-- disconnected by the time the penalty is applied.
CREATE TABLE game_lobby_violations (
  game_id UUID PRIMARY KEY REFERENCES games (id),
  user_id INTEGER NOT NULL REFERENCES users (id),
  detected_at TIMESTAMPTZ NOT NULL,
  identifiers JSONB NOT NULL DEFAULT '[]',
  recovery_attempts INTEGER NOT NULL DEFAULT 0,
  next_recovery_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Claims a matchmaking ban for a game+user before identifier-specific ban rows are written. The
-- composite key makes a late relay retry observe the same claim instead of escalating again.
CREATE TABLE matchmaking_game_bans (
  game_id UUID NOT NULL REFERENCES games (id),
  user_id INTEGER NOT NULL REFERENCES users (id),
  penalty TEXT NOT NULL CHECK (penalty IN ('lossAndBan', 'lossAndWarning')),
  enforcement_claimed_at TIMESTAMPTZ NULL,
  enforced_at TIMESTAMPTZ NULL,
  PRIMARY KEY (game_id, user_id)
);