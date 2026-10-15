-- 3v3 ratings are now updated against the whole team's expected result, which spreads them across a
-- much wider range than the old individual updates did. Most established 3v3 players sit at a low
-- uncertainty, which would make their ratings very slow to move to that wider range, so raise every
-- 3v3 uncertainty below 200 to 200.
--
-- A player's rating in a new season is carried over from their most recent earlier row for that
-- mode, so the latest row per player and mode is the one that matters (in the current season or
-- carried into the next one). Older rows are left as they were.
UPDATE matchmaking_ratings mr
SET uncertainty = 200
FROM (
  SELECT DISTINCT ON (r.user_id, r.matchmaking_type) r.user_id, r.matchmaking_type, r.season_id
  FROM matchmaking_ratings r
  JOIN matchmaking_seasons s ON s.id = r.season_id
  WHERE r.matchmaking_type IN ('3v3bgh', '3v3hunters', '3v3fastest')
  ORDER BY r.user_id, r.matchmaking_type, s.start_date DESC
) latest
WHERE
  mr.user_id = latest.user_id
  AND mr.matchmaking_type = latest.matchmaking_type
  AND mr.season_id = latest.season_id
  AND mr.uncertainty < 200;
