-- Permission gating the matchmaker-config admin tools (the GraphQL query/mutation that read and
-- rewrite matchmaking_config). Separate from manageMatchmakingTimes/Seasons because it controls the
-- matchmaker's tuning knobs themselves, not the schedule or season metadata.
ALTER TABLE permissions ADD COLUMN manage_matchmaking boolean NOT NULL DEFAULT false;
