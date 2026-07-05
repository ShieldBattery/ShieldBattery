-- Adds a table recording relay-observed mid-game desync events (relay -> coordinator -> app server
-- webhook), so the app server has a durable, queryable feed of when the netcode v2 sync-checksum
-- comparator saw a slot diverge from the agreeing majority.
--
-- This table only records events; a later reconciliation slice consumes them (majority-authoritative
-- resolution / voiding / lobby-dispute). No games_users column: per-player fault is derived from
-- these rows, not stored redundantly on the game record.
--
-- PRIMARY KEY (game_id, sync_ordinal) makes ingest idempotent under at-least-once webhook delivery:
-- INSERT ... ON CONFLICT DO NOTHING is a no-op for a retried/redundant delivery of the same event.

CREATE TABLE game_desync_events (
  game_id UUID NOT NULL,
  sync_ordinal BIGINT NOT NULL,
  detected_at TIMESTAMPTZ NOT NULL,
  game_frame INTEGER NULL,
  no_majority BOOLEAN NOT NULL,
  diverged_user_ids INTEGER[] NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (game_id, sync_ordinal)
);
