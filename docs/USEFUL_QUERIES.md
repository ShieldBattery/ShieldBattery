# Useful database queries

If you're running your database via docker-compose, you can connect to it via `psql` by doing:

```sh
docker exec -it shieldbattery_db_1 psql -U postgres --dbname shieldbattery
```

(Connecting with other installed clients will also work, provided its network is accessible to you.)

## Median Matchmaking Cancel Time

```sql
SELECT matchmaking_type, percentile_cont(0.5)
WITHIN GROUP (ORDER BY search_time_millis)
FILTER (WHERE completion_type = 'cancel')
FROM matchmaking_completions
GROUP BY matchmaking_type;
```

# Matchmaker calibration

These queries are for evaluating how well the matchmaker's predictions and quality formula hold up
against real outcomes, so weight/formula changes can be made from data rather than guesswork. The
first two run on data we've always had (`matchmaking_rating_changes.probability`); the rest depend on
the `matchmaking_match_formations` table and `matchmaking_completions.rating`, which are only
populated for games/searches that happened **after** that migration, so they'll be empty until enough
new data accumulates.

## Rating prediction reliability (predicted vs. actual win rate)

Buckets every per-player, per-game predicted win probability and compares the average prediction in
each bucket to the actual win rate. A well-calibrated model has `predicted_win_rate ≈
actual_win_rate` in every row. Systematic gaps (e.g. favorites winning more/less than predicted) mean
the rating→win-probability mapping needs tuning. Note each 1v1 game contributes two rows (one per
player, with complementary probabilities); team games contribute one row per player.

```sql
SELECT
  width_bucket(probability, 0, 1, 10) AS bucket,
  round(min(probability)::numeric, 3) AS min_p,
  round(max(probability)::numeric, 3) AS max_p,
  count(*) AS predictions,
  round(avg(probability)::numeric, 4) AS predicted_win_rate,
  round(avg((outcome = 'win')::int)::numeric, 4) AS actual_win_rate
FROM matchmaking_rating_changes
-- Optionally restrict to one mode, e.g.:  WHERE matchmaking_type = '1v1'
GROUP BY bucket
ORDER BY bucket;
```

## Prediction accuracy score (Brier score + log loss) per mode

Single-number summaries of prediction quality per mode, useful for tracking calibration over time or
comparing modes. Lower is better for both. A Brier score of 0.25 / log loss of ~0.693 is what you'd
get from always predicting 0.5 (no skill information), so values meaningfully below that mean the
ratings carry real predictive signal.

```sql
SELECT
  matchmaking_type,
  count(*) AS predictions,
  round(avg(power(probability - (outcome = 'win')::int, 2))::numeric, 4) AS brier_score,
  round(avg(
    -1 * (
      (outcome = 'win')::int * ln(greatest(probability, 1e-15)) +
      (1 - (outcome = 'win')::int) * ln(greatest(1 - probability, 1e-15))
    )
  )::numeric, 4) AS log_loss
FROM matchmaking_rating_changes
GROUP BY matchmaking_type
ORDER BY matchmaking_type;
```

## Match balance vs. game length (does "balanced" produce closer games?)

Tests the core assumption behind the quality formula: that matches the matchmaker considers balanced
actually play out as longer, closer games. Buckets formed matches by how far their predicted win
probability was from a 50/50 split and shows the median game length per bucket. If the formula is
working, more-balanced matches (lower `avg_imbalance`) should trend toward longer median games.
Because game length is heavily mode-dependent (Fastest/BGH games are short by nature), filter to a
single mode for a meaningful comparison.

```sql
SELECT
  width_bucket(abs(0.5 - f.win_probability), 0, 0.5, 5) AS imbalance_bucket,
  count(*) AS games,
  round(avg(abs(0.5 - f.win_probability))::numeric, 3) AS avg_imbalance,
  round(
    ((percentile_cont(0.5) WITHIN GROUP (ORDER BY g.game_length)) / 60000.0)::numeric, 1
  ) AS median_minutes
FROM matchmaking_match_formations f
JOIN games g ON g.id = f.game_id
WHERE g.game_length IS NOT NULL
  AND f.matchmaking_type = '1v1'
GROUP BY imbalance_bucket
ORDER BY imbalance_bucket;
```

## Distribution of formed-match quality and its components

A health check on what the matchmaker is actually shipping: how negative the quality scores are (how
often the adaptive low-population threshold is carrying matches), and how much each penalty term
(skill spread, win-probability imbalance, latency) contributes on average. Useful before changing any
of the `WEIGHT_*` constants in `server-rs/src/matchmaking/matchmaker.rs`. Scoped to matches that
actually launched (`game_id IS NOT NULL`); the failed-to-start query below breaks down the rest.

```sql
SELECT
  matchmaking_type,
  count(*) AS matches,
  round(avg(quality)::numeric, 1) AS avg_quality,
  round((percentile_cont(0.5) WITHIN GROUP (ORDER BY quality))::numeric, 1) AS median_quality,
  round(avg(skill_variance)::numeric, 0) AS avg_skill_variance,
  round(avg(abs(0.5 - win_probability))::numeric, 3) AS avg_winprob_imbalance,
  -- max_latency is the estimated one-way latency (ms) of the match's worst pairwise link.
  round(avg(max_latency)::numeric, 2) AS avg_max_latency_ms
FROM matchmaking_match_formations
WHERE game_id IS NOT NULL
GROUP BY matchmaking_type
ORDER BY matchmaking_type;
```

## Predicted vs. actual match latency

Validates the latency input to the quality formula before trusting `WEIGHT_LATENCY`. The matcher
estimates a match's latency at *queue time* from each player's rally-point pings (stored as
`match_formations.max_latency`, the worst pairwise one-way link). When the game actually launches, the
game loader re-picks routes from *fresh* pings and records the real per-pair latency in `games.routes`
— so the worst actual route latency is the ground truth for what the matcher predicted. A small
`avg_bias_ms` / `median_abs_error_ms` means the queue-time estimate is trustworthy and the latency
weight can be tuned against it; a large error means pings drift too much between queue and launch for
the term to be reliable.

```sql
WITH paired AS (
  SELECT
    f.matchmaking_type,
    f.max_latency AS predicted_ms,
    -- Worst actual one-way link, mirroring how max_latency takes the max across pairs.
    (SELECT max((r->>'latency')::real) FROM unnest(g.routes) AS r) AS actual_ms
  FROM matchmaking_match_formations f
  JOIN games g ON g.id = f.game_id
  WHERE g.routes IS NOT NULL AND array_length(g.routes, 1) > 0
)
SELECT
  matchmaking_type,
  count(*) AS games,
  round(avg(predicted_ms)::numeric, 1) AS avg_predicted_ms,
  round(avg(actual_ms)::numeric, 1) AS avg_actual_ms,
  -- Signed: positive means the game ended up laggier than the matcher predicted.
  round(avg(actual_ms - predicted_ms)::numeric, 1) AS avg_bias_ms,
  round((percentile_cont(0.5)
    WITHIN GROUP (ORDER BY abs(actual_ms - predicted_ms)))::numeric, 1) AS median_abs_error_ms
FROM paired
GROUP BY matchmaking_type
ORDER BY matchmaking_type;
```

## Queue health by skill band (search time + abandonment rate)

Uses the rating captured at queue time to show where matchmaking is painful: which skill bands wait
longest and give up most often. High `abandon_rate` or `median_found_secs` in a band points to a
population/quality-threshold problem for that band rather than the matchmaker overall.

```sql
SELECT
  matchmaking_type,
  width_bucket(rating, 1000, 2500, 6) AS rating_band,
  count(*) FILTER (WHERE completion_type = 'found') AS found,
  count(*) FILTER (WHERE completion_type IN ('cancel', 'disconnect')) AS abandoned,
  round(
    count(*) FILTER (WHERE completion_type IN ('cancel', 'disconnect'))::numeric /
      greatest(count(*), 1), 3
  ) AS abandon_rate,
  round(
    (percentile_cont(0.5) WITHIN GROUP (ORDER BY search_time_millis)
      FILTER (WHERE completion_type = 'found') / 1000.0)::numeric, 1
  ) AS median_found_secs
FROM matchmaking_completions
WHERE rating IS NOT NULL
GROUP BY matchmaking_type, rating_band
ORDER BY matchmaking_type, rating_band;
```

## Search outcome breakdown per mode (found vs. abandoned)

The top of the funnel: of all searches that ended, how many found a match versus were canceled or
disconnected, per mode. A low `found_rate` for a mode is the clearest single signal that it's
population-starved (people give up before a match forms). Pair this with the live
`matchmaker_population_estimate` gauge to tell "nobody's queuing" apart from "they queue but can't be
matched".

```sql
SELECT
  matchmaking_type,
  count(*) AS searches,
  count(*) FILTER (WHERE completion_type = 'found') AS found,
  count(*) FILTER (WHERE completion_type = 'cancel') AS canceled,
  count(*) FILTER (WHERE completion_type = 'disconnect') AS disconnected,
  round(
    count(*) FILTER (WHERE completion_type = 'found')::numeric / greatest(count(*), 1), 3
  ) AS found_rate
FROM matchmaking_completions
GROUP BY matchmaking_type
ORDER BY matchmaking_type;
```

## Formed-match start outcomes per mode (launched vs. failed by phase)

Of the matches the matchmaker actually formed, how many launched versus fell apart before the game
started, broken down by the phase they failed in (`accepting` = ready-up declines/timeouts,
`drafting` = race draft canceled, `loading` = game failed to load). A rising `failed_to_start_rate`
for a mode points at a launch/draft problem rather than a matching one; which phase dominates says
where to look. This is the durable counterpart to the live
`shieldbattery_matchmaker_match_failed_total{phase=...}` counter.

```sql
SELECT
  matchmaking_type,
  count(*) AS formed,
  count(*) FILTER (WHERE game_id IS NOT NULL) AS launched,
  count(*) FILTER (WHERE fail_phase = 'accepting') AS failed_accepting,
  count(*) FILTER (WHERE fail_phase = 'drafting') AS failed_drafting,
  count(*) FILTER (WHERE fail_phase = 'loading') AS failed_loading,
  round(
    count(*) FILTER (WHERE fail_phase IS NOT NULL)::numeric / greatest(count(*), 1), 3
  ) AS failed_to_start_rate
FROM matchmaking_match_formations
GROUP BY matchmaking_type
ORDER BY matchmaking_type;
```

## What kind of matches fail to start (decision inputs of failed vs. launched)

Joins each formed match's outcome back to the matchmaker decision that produced it, so a failed-start
cohort can be compared to the launched one on the exact quality/win-probability/latency inputs. If, say,
`loading` failures skew toward a much higher `avg_max_latency_ms` than launched matches, the problem is
networking rather than the matcher; if failed matches cluster at very negative `avg_quality`, the
adaptive threshold is forming matches nobody sticks around for.

```sql
SELECT
  matchmaking_type,
  CASE WHEN game_id IS NOT NULL THEN 'launched' ELSE fail_phase END AS outcome,
  count(*) AS matches,
  round(avg(quality)::numeric, 1) AS avg_quality,
  round(avg(abs(0.5 - win_probability))::numeric, 3) AS avg_winprob_imbalance,
  round(avg(max_latency)::numeric, 1) AS avg_max_latency_ms
FROM matchmaking_match_formations
GROUP BY matchmaking_type, outcome
ORDER BY matchmaking_type, outcome;
```

## Launched matches that produced no game result

The post-launch counterpart to the failed-to-start query: a match that loaded into a game, but that
game never recorded a result (it crashed, everyone quit before it counted, etc.). A rising
`no_result_rate` points at in-game problems rather than the matchmaker or the launch funnel. Scoped to
launched matches (`game_id IS NOT NULL`); legacy `games.results` rows can be `{}` instead of an array,
so the array shape is guarded explicitly.

```sql
SELECT
  f.matchmaking_type,
  count(*) AS launched,
  count(*) FILTER (
    WHERE jsonb_typeof(g.results) <> 'array'
       OR jsonb_array_length(g.results) = 0
  ) AS no_result,
  round(
    count(*) FILTER (
      WHERE jsonb_typeof(g.results) <> 'array'
         OR jsonb_array_length(g.results) = 0
    )::numeric / greatest(count(*), 1), 3
  ) AS no_result_rate
FROM matchmaking_match_formations f
JOIN games g ON g.id = f.game_id
WHERE f.game_id IS NOT NULL
GROUP BY f.matchmaking_type
ORDER BY f.matchmaking_type;
```

## Matchmaking volume by hour of day (UTC) per mode

When each mode is actually alive. Useful for deciding matchmaking-times windows and for reading the
population gauges in context (a dead 03:00 UTC hour relaxing the threshold is expected, the same at
peak is not). Hours are UTC, matching how the database stores timestamps.

```sql
SELECT
  config->'gameSourceExtra'->>'type' AS matchmaking_type,
  extract(hour FROM start_time)::int AS hour_utc,
  count(*) AS games
FROM games
WHERE config->>'gameSource' = 'MATCHMAKING'
  AND start_time >= now() - INTERVAL '30 days'
GROUP BY matchmaking_type, hour_utc
ORDER BY matchmaking_type, hour_utc;
```

## Formed-match balance trend over time per mode

The "Distribution of formed-match quality" query above is a point-in-time snapshot; this is the same
idea as a daily time series, so a weight/threshold change's effect on balance can be watched over the
days after it ships. Filter to a single mode when eyeballing a specific change.

```sql
SELECT
  f.matchmaking_type,
  date_trunc('day', g.start_time)::date AS day,
  count(*) AS matches,
  round(avg(abs(0.5 - f.win_probability))::numeric, 3) AS avg_winprob_imbalance,
  round(avg(f.quality)::numeric, 1) AS avg_quality
FROM matchmaking_match_formations f
JOIN games g ON g.id = f.game_id
WHERE g.start_time >= now() - INTERVAL '30 days'
GROUP BY f.matchmaking_type, day
ORDER BY f.matchmaking_type, day;
```

## Recent game rally-point routes + estimated latency, 1 route per row

Change the first common table expression to select the game entries you care about.

```sql
WITH game_routes AS (
	SELECT g.id, g.start_time, g.routes FROM games g
	WHERE g.routes IS NOT NULL
	ORDER BY g.start_time DESC
	LIMIT 10
) SELECT g.id AS game_id, u1.name AS p1, u2.name AS p2, r.description AS "server", g.route->>'latency' AS latency
FROM (SELECT g.id, UNNEST(g.routes) AS route, g.start_time FROM game_routes g) g
JOIN rally_point_servers r ON (route->>'server')::NUMERIC = r.id
JOIN users u1 ON (g.route->>'p1')::NUMERIC = u1.id
JOIN users u2 ON (g.route->>'p2')::NUMERIC = u2.id
ORDER BY g.start_time, p1;
```

## Veto count for each map in the current map pool

This query returns maps grouped by each matchmaking type, but it's easy to add a filter for a
single matchmaking type if you're interested in only one.

```sql
WITH mmp AS (
  SELECT matchmaking_type, MAX(id) AS current_map_pool
  FROM matchmaking_map_pools
  GROUP BY matchmaking_type
)
SELECT name, COUNT(*) AS vetoes, matchmaking_type
FROM (
  SELECT unnest(map_selections) AS map_id, map_pool_id
  FROM matchmaking_preferences
) mp
INNER JOIN uploaded_maps um ON um.id = mp.map_id
INNER JOIN mmp ON mmp.current_map_pool = mp.map_pool_id
GROUP BY name, matchmaking_type
ORDER BY matchmaking_type, vetoes DESC;
```

## Count matchmaking games by season and type

```sql
WITH seasons AS (
	SELECT ms.id, ms.start_date, LEAD(ms.start_date, 1) OVER (ORDER BY start_date) end_date, ms.name
	FROM matchmaking_seasons ms
	ORDER BY start_date DESC
)
SELECT s.name, g.config->'gameSourceExtra'->>'type', COUNT(*)
FROM games g
JOIN seasons s
ON g.start_time >= s.start_date
AND g.start_time < s.end_date
WHERE g.config->>'gameSource' = 'MATCHMAKING'
GROUP BY s.name, g.config->'gameSourceExtra'->>'type'
ORDER BY s.name, g.config->'gameSourceExtra'->>'type';
```

## Count the number of matchmaking games played for each player in a given time period

You can adjust the query to count the games for a different matchmaking type and/or a different time
period. Keep in mind that the database is using the UTC time zone.

```sql
SELECT u.name AS user_name, COUNT(gu.game_id) AS games_played
FROM games_users gu
INNER JOIN users u ON gu.user_id = u.id
INNER JOIN games g ON gu.game_id = g.id
WHERE
  gu.start_time >= '2022-11-30 23:00:00' AND
  gu.start_time < '2023-01-01 01:00:00' AND
  g.config->>'gameSource' = 'MATCHMAKING' AND
  g.config->'gameSourceExtra'->>'type' = '2v2'
GROUP BY user_name
ORDER BY games_played DESC;
```

## Count the number of matchmaking games in a given time period

By default, the query shows the number of 1v1 matchmaking games in the past 30 days. Includes the
dates with 0 games played (so the output can be easily fed into a line chart).

```sql
WITH g AS (
  SELECT date_trunc('day', start_time)::date AS date, COUNT(*) AS games_count
  FROM games
  WHERE
    config->>'gameSource' = 'MATCHMAKING' AND
    config->'gameSourceExtra'->>'type' = '1v1'
  GROUP BY date
)
SELECT date_trunc('day', days)::date AS date, COALESCE(g.games_count, 0) AS games_count
FROM generate_series(NOW() - INTERVAL '30 day', NOW(), INTERVAL '1 day') days
LEFT JOIN g ON date_trunc('day', days)::date = g.date
GROUP BY days, games_count
ORDER BY days;
```

## Calculate the matchup stats for each map in a given league

This query assumes a 1v1 league. Calculating stats for 2v2 leagues is left as an exercise to the
reader.

```sql
WITH
lg AS (
  SELECT DISTINCT(game_id)
  FROM league_user_changes
  WHERE league_id = ${leagueId}
),
stats AS (
  SELECT
    m.name AS map_name,
    COUNT(g.id) AS total_games,
    COUNT(g.id) FILTER (WHERE g.results @> '[[{"race":"p", "result":"win"}],[{"race":"z", "result":"loss"}]]') AS pvz_wins,
    COUNT(g.id) FILTER (WHERE g.results @> '[[{"race":"p", "result":"loss"}],[{"race":"z", "result":"win"}]]') AS pvz_losses,
    COUNT(g.id) FILTER (WHERE g.results @> '[[{"race":"p", "result":"win"}],[{"race":"t", "result":"loss"}]]') AS pvt_wins,
    COUNT(g.id) FILTER (WHERE g.results @> '[[{"race":"p", "result":"loss"}],[{"race":"t", "result":"win"}]]') AS pvt_losses,
    COUNT(g.id) FILTER (WHERE g.results @> '[[{"race":"t", "result":"win"}],[{"race":"z", "result":"loss"}]]') AS tvz_wins,
    COUNT(g.id) FILTER (WHERE g.results @> '[[{"race":"t", "result":"loss"}],[{"race":"z", "result":"win"}]]') AS tvz_losses,
    COUNT(g.id) FILTER (WHERE g.results @> '[[{"race":"t", "result":"win"}],[{"race":"p", "result":"loss"}]]') AS tvp_wins,
    COUNT(g.id) FILTER (WHERE g.results @> '[[{"race":"t", "result":"loss"}],[{"race":"p", "result":"win"}]]') AS tvp_losses,
    COUNT(g.id) FILTER (WHERE g.results @> '[[{"race":"z", "result":"win"}],[{"race":"p", "result":"loss"}]]') AS zvp_wins,
    COUNT(g.id) FILTER (WHERE g.results @> '[[{"race":"z", "result":"loss"}],[{"race":"p", "result":"win"}]]') AS zvp_losses,
    COUNT(g.id) FILTER (WHERE g.results @> '[[{"race":"z", "result":"win"}],[{"race":"t", "result":"loss"}]]') AS zvt_wins,
    COUNT(g.id) FILTER (WHERE g.results @> '[[{"race":"z", "result":"loss"}],[{"race":"t", "result":"win"}]]') AS zvt_losses
  FROM games g
  INNER JOIN uploaded_maps m ON g.map_id = m.id
  INNER JOIN lg ON g.id = game_id
  GROUP BY m.name
)
SELECT
  map_name,
  total_games,
  pvz_wins || '-' || pvz_losses AS pvz_stats,
  ROUND(pvz_wins::decimal / GREATEST(pvz_wins + pvz_losses, 1) * 100, 2) || '%' AS pvz_rate,
  pvt_wins || '-' || pvt_losses AS pvt_stats,
  ROUND(pvt_wins::decimal / GREATEST(pvt_wins + pvt_losses, 1) * 100, 2) || '%' AS pvt_rate,
  tvz_wins || '-' || tvz_losses AS tvz_stats,
  ROUND(tvz_wins::decimal / GREATEST(tvz_wins + tvz_losses, 1) * 100, 2) || '%' AS tvz_rate,
  tvp_wins || '-' || tvp_losses AS tvp_stats,
  ROUND(tvp_wins::decimal / GREATEST(tvp_wins + tvp_losses, 1) * 100, 2) || '%' AS tvp_rate,
  zvp_wins || '-' || zvp_losses AS zvp_stats,
  ROUND(zvp_wins::decimal / GREATEST(zvp_wins + zvp_losses, 1) * 100, 2) || '%' AS zvp_rate,
  zvt_wins || '-' || zvt_losses AS zvt_stats,
  ROUND(zvt_wins::decimal / GREATEST(zvt_wins + zvt_losses, 1) * 100, 2) || '%' AS zvt_rate
FROM stats;
```

# Creating a readonly role and user logins

These must be executed as the superuser.

```sql
CREATE ROLE shieldbattery_reader WITH
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  INHERIT
  NOLOGIN
  NOREPLICATION
  NOBYPASSRLS;

REVOKE ALL PRIVILEGES ON SCHEMA public FROM shieldbattery_reader;
GRANT USAGE ON SCHEMA public TO shieldbattery_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO shieldbattery_reader;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO shieldbattery_reader;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO shieldbattery_reader;
REVOKE ALL PRIVILEGES ON users_private FROM shieldbattery_reader;

ALTER DEFAULT PRIVILEGES
IN SCHEMA public
GRANT SELECT ON TABLES TO shieldbattery_reader;

ALTER DEFAULT PRIVILEGES
IN SCHEMA public
GRANT EXECUTE ON FUNCTIONS TO shieldbattery_reader;

SET ROLE shieldbattery;

ALTER DEFAULT PRIVILEGES
IN SCHEMA public
GRANT SELECT ON TABLES TO shieldbattery_reader;

ALTER DEFAULT PRIVILEGES
IN SCHEMA public
GRANT EXECUTE ON FUNCTIONS TO shieldbattery_reader;
```

To add a new user with that role:

```sql
CREATE ROLE <username> WITH
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  INHERIT
  LOGIN
  NOREPLICATION
  NOBYPASSRLS
  PASSWORD '<password>';

REVOKE ALL PRIVILEGES ON SCHEMA public FROM <username>;
GRANT shieldbattery_reader TO <username>;
```
