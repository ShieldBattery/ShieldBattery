-- Positive recognition one player gives another after a game they both played in. Backed by
-- server-rs; see the game_commends GraphQL module. The window for giving one, the daily limits and
-- the rule that a player can't both commend and report the same player in one game are enforced
-- there; this table enforces one commend per giver per target per game.
CREATE TABLE game_commends (
  id uuid PRIMARY KEY DEFAULT sb_uuid(),
  game_id uuid NOT NULL REFERENCES games (id) ON DELETE CASCADE,
  commender_id integer NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  commended_user_id integer NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (commender_id, game_id, commended_user_id),
  CONSTRAINT game_commends_not_self CHECK (commender_id <> commended_user_id)
);

-- A commender's last 24 hours, for the daily limit and the once-per-player cooldown. The daily limit
-- keeps this range to a handful of rows.
CREATE INDEX game_commends_commender_created_index ON game_commends (commender_id, created_at);
-- Keeps deleting a user (the ON DELETE CASCADE above) from scanning the whole table.
CREATE INDEX game_commends_commended_user_index ON game_commends (commended_user_id);

-- Commends received, all time. Incremented in the same transaction as each game_commends insert so
-- profiles read one column instead of counting rows. It only goes up: rows removed by a commender's
-- account being deleted keep the count they added. A constant default makes this a metadata-only
-- change with no table rewrite.
ALTER TABLE users ADD COLUMN commend_count integer NOT NULL DEFAULT 0;
