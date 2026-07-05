-- Adds columns for the netcode-v2 relay's timing stamp on a result report (relay -> coordinator ->
-- app server webhook): when the relay's connection to the reporting client received the report,
-- and the relay's local session frame at that moment.
--
-- These are audit/timeline only -- they drive no reconciliation policy. They exist so a stored
-- report's arrival can be read against the same relay timeline as departures and desync events,
-- instead of comparing timestamps from two different clocks.
--
-- NOTE: Nullable-column ALTER TABLE is metadata-only, so this is instant and holds no long lock.
-- Populated by setReportedResults (server/lib/models/games-users.ts).

ALTER TABLE games_users ADD COLUMN relay_report_time TIMESTAMPTZ NULL;
ALTER TABLE games_users ADD COLUMN relay_report_frame INTEGER NULL;
