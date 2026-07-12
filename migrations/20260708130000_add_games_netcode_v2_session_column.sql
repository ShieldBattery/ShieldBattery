-- Persists the rally-point2 coordinator's session id for a netcode-v2 game, so the reconciliation
-- sweep can ask the coordinator whether a session is still alive instead of blind-forcing after a
-- fixed timeout.
--
-- Session ids are coordinator-minted u64s derived from a timestamp in microseconds, so they fit
-- comfortably inside a signed BIGINT.
--
-- NOTE: Nullable-column ALTER TABLE is metadata-only, so this is instant and holds no long lock.
-- Populated by setNetcodeV2Session (server/lib/games/game-models.ts), called by NetcodeV2Service
-- right after the coordinator's session/create call succeeds.

ALTER TABLE games ADD COLUMN netcode_v2_session BIGINT NULL;
