CREATE TABLE user_identifier_observations (
    request_id UUID PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    observed_at TIMESTAMPTZ NOT NULL,
    identifiers_hash BYTEA NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    CHECK (octet_length(identifiers_hash) = 32)
);

CREATE INDEX user_identifier_observations_expiration
    ON user_identifier_observations (expires_at, request_id);

CREATE TABLE user_identifier_reconciliation (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    revision BIGINT NOT NULL DEFAULT 1,
    processed_revision BIGINT NOT NULL DEFAULT 0,
    request_id UUID NOT NULL UNIQUE DEFAULT uuid_generate_v4(),
    action_state TEXT NOT NULL DEFAULT 'idle' CHECK (action_state IN ('idle', 'pending', 'done')),
    end_time TIMESTAMPTZ,
    not_before TIMESTAMPTZ,
    retry_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    pending_since TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (user_id, game_id),
    CHECK (revision >= processed_revision),
    CHECK (action_state <> 'pending' OR (end_time IS NOT NULL AND not_before IS NOT NULL))
);

CREATE INDEX user_identifier_reconciliation_pending
    ON user_identifier_reconciliation (retry_at)
    WHERE revision > processed_revision OR action_state = 'pending';

CREATE INDEX user_identifier_reconciliation_expiration
    ON user_identifier_reconciliation (expires_at, user_id, game_id)
    WHERE revision = processed_revision AND action_state IN ('idle', 'done');

CREATE INDEX user_identifier_reconciliation_pending_since
    ON user_identifier_reconciliation (pending_since)
    WHERE revision > processed_revision;

CREATE INDEX user_identifier_reconciliation_due
    ON user_identifier_reconciliation (not_before)
    WHERE action_state = 'pending';
