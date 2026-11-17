-- Gives results-exempt games (a computer player, or fewer than two humans) a length from the
-- replays already stored for them. Those games never reconcile, so game_length stayed NULL. A
-- game's length is its replay's frame count at 42 ms per frame, the same measure the game client
-- stores for reconciled games. Each replay ends when its player left, so the longest one wins.
-- The result is capped to the integer column's range.
UPDATE games g
SET game_length = r.length
FROM (
  SELECT g2.id, LEAST(MAX((rf.header->>'frames')::bigint) * 42, 2147483647)::integer AS length
  FROM games g2
  JOIN games_users gu ON gu.game_id = g2.id
  JOIN replay_files rf ON rf.id = gu.replay_file_id
  WHERE g2.game_length IS NULL
    AND g2.results IS NULL
    AND g2.canceled_at IS NULL
    AND (g2.config->>'resultsExempt')::boolean IS TRUE
  GROUP BY g2.id
) r
WHERE g.id = r.id AND r.length IS NOT NULL;
