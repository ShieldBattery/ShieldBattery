-- Records what each of a netcode-v2 game's session slots asked for at queue/join time: the
-- game-server region the player wanted, the round-trip time they measured to it (if any), and
-- whether that region came from their manual server-region setting rather than the automatic
-- lowest-RTT pick. This is the request side of a session's placement; netcode_v2_relays is the
-- serving side. Tracing an incident needs both: a slot whose requested region had no live relay is
-- served from somewhere else entirely, and only this column shows that gap -- or that the player
-- queued region-blind to begin with.
--
-- Rows are a JSON array with one entry per slot, written once at session create by
-- setNetcodeV2RequestedRegions (server/lib/games/game-models.ts) and never appended to, since it is
-- create-time truth rather than a history.
--
-- NOTE: Nullable-column ALTER TABLE is metadata-only, so this is instant and holds no long lock.

ALTER TABLE games ADD COLUMN netcode_v2_requested_regions JSONB NULL;
