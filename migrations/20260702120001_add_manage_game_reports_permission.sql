-- Permission gating the game-report moderation tools (the GraphQL query/mutations that list and
-- resolve game_reports). Separate from manage_bug_reports because moderating player reports is a
-- different responsibility than triaging bug logs.
ALTER TABLE permissions ADD COLUMN manage_game_reports boolean NOT NULL DEFAULT false;
