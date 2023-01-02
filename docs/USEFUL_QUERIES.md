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
period.

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
