# Upgrading Postgres

Whenever the project updates its Postgres dependency to a new major version, there are a series of
steps you must perform to move data over. These steps assume you are using Docker, but could be
easily adapted to a local install if necessary.

1. Do _NOT_ update the `docker-compose.yml` file to the latest one with the newer Postgres yet.
2. Stop all containers: `docker compose down`
   - If for local development, ensure any development servers are also stopped.
3. Run only the database container: `docker compose up -d db`
4. Generate a data backup: `docker compose exec db pg_dumpall --clean --if-exists --username postgres > backup.sql`
5. Stop the database container: `docker compose down`
6. Remove the old db volume: `docker volume remove shieldbattery_db_data`
7. Update `docker-compose.yml` to have the new dependency versions
8. Pull new container versions: `docker compose pull`
9. Run only the database container: `docker compose up -d db`
10. Restore from the backup: `cat backup.sql | docker compose exec -T db psql --username postgres`
11. Start the other containers: `docker compose up -d`

You may need to update the passwords for any users, depending on which version you are upgrading
from/to (as the password storage has changed). To do so:

```
docker compose exec -T db psql --username postgres -c "ALTER USER postgres WITH PASSWORD '<PASS>'"
docker compose exec -T db psql --username postgres -c "ALTER USER shieldbattery WITH PASSWORD '<PASS>'"
```
