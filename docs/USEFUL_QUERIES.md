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
