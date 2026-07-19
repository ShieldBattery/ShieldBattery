-- Appends a durable relay-serving history to a netcode-v2 game: the session's serving relay(s) at
-- create time, plus every rehome that later moved the group to a replacement. Flight-recorder blobs
-- for a session are stored per (tenant, session, relay_id), so this is the index that answers "which
-- relay(s) served this game's session, and when" straight from the game record when tracing an
-- incident.
--
-- Rows are a JSON array of versionless, kind-discriminated events (`home` / `rehome`), appended by
-- addNetcodeV2RelayEvents (server/lib/games/game-models.ts). Written at session create (the home
-- relay plus any slot-home override relays) and on each coordinator `newTarget` rehome decision.
--
-- NOTE: Nullable-column ALTER TABLE is metadata-only, so this is instant and holds no long lock.

ALTER TABLE games ADD COLUMN netcode_v2_relays JSONB NULL;
