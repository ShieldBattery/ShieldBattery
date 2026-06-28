-- Append-only audit of every matchmaking_config change, so a bad tune is traceable and revertable.
-- One row is inserted by the admin mutation on each successful update, capturing the full config
-- that was written and who wrote it.
CREATE TABLE matchmaking_config_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  config jsonb NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by integer REFERENCES users (id) ON DELETE SET NULL
);
