-- The chat sent during a team matchmaking game's race draft, which is otherwise only relayed live to
-- each team. Kept so admins can review it alongside the game's in-game chat. Rows are written once,
-- when the game launches; a draft whose match never produced a game is not recorded.
--
-- Draft chat only ever reaches the sender's own team, so a message's audience follows from which
-- team its sender was on in the game's config. `seq` orders the messages within a game.

CREATE TABLE matchmaking_draft_messages (
  game_id uuid NOT NULL REFERENCES games (id) ON DELETE CASCADE,
  seq integer NOT NULL,
  user_id integer NOT NULL,
  sent_at timestamptz NOT NULL,
  text text NOT NULL,
  PRIMARY KEY (game_id, seq)
);
