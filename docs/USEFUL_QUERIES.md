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
