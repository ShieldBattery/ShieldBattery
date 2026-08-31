# Out-of-band data backfills

One-off scripts that populate new columns from historical data after a release. They live outside
`migrations/` on purpose: a backfill rewrites (potentially) every row of a large, hot table, and
doing that inside a migration would hold locks for the whole run and block the deploy. Instead,
the migration does only the instant DDL, and the backfill here is run manually afterwards, in
id-range batches with a `COMMIT` after each batch so normal traffic can interleave.

Scripts are named `<YYYY-MM-DD>-<what-they-fill>.sql`, dated by when they were added, so the
directory reads in the order the backfills entered the codebase.

Each script installs a stored procedure and documents its own usage in its header comment, but the
common lifecycle is:

1. Deploy the release (migration applied, new app code writing the column for new rows).
2. Install the procedure, dry-run it, read the counts.
3. Run it for real. Progress arrives as `NOTICE` messages per batch.
4. Optionally re-run after the deploy has settled — the scripts are idempotent and only write rows
   whose computed value differs, so a second pass cheaply catches games written by old code during
   the deploy window.
5. Drop the procedure.

## Running against a deployed server

Nothing in this directory ships in the server image, and the db container is stock `postgres:17` —
but `psql` reads stdin, so the script can be streamed from a local checkout straight through ssh
into the container (same pattern as the dump-restore instructions in
[docs/DEPLOYMENT.md](../../docs/DEPLOYMENT.md)):

```sh
# 1. Install/update the procedure
ssh $HOST 'docker exec -i shieldbattery-db-1 psql -U shieldbattery -d shieldbattery -v ON_ERROR_STOP=1' \
  < tools/backfills/2026-08-09-backfill-teams.sql

# 2. Dry run
ssh $HOST 'docker exec -i shieldbattery-db-1 psql -U shieldbattery -d shieldbattery \
  -c "CALL backfill_teams(dry_run => true);"'

# 3. Real run
ssh $HOST 'docker exec -i shieldbattery-db-1 psql -U shieldbattery -d shieldbattery \
  -c "CALL backfill_teams();"'

# 4. Cleanup
ssh $HOST 'docker exec -i shieldbattery-db-1 psql -U shieldbattery -d shieldbattery \
  -c "DROP PROCEDURE backfill_teams(int, boolean);"'
```

From a Windows terminal, use PowerShell. Nested double quotes don't survive the
PowerShell → ssh → remote-shell trip, so instead of `-c` the statements are piped through stdin
(psql executes stdin exactly the same way). `$HOST` is a reserved automatic variable in
PowerShell, hence `$server`:

```powershell
$server = 'user@example.org'
$psql = 'docker exec -i shieldbattery-db-1 psql -U shieldbattery -d shieldbattery'

# 1. Install/update the procedure
Get-Content -Raw tools\backfills\2026-08-09-backfill-teams.sql | ssh $server "$psql -v ON_ERROR_STOP=1"

# 2. Dry run
'CALL backfill_teams(dry_run => true);' | ssh $server $psql

# 3. Real run
'CALL backfill_teams();' | ssh $server $psql

# 4. Cleanup
'DROP PROCEDURE backfill_teams(int, boolean);' | ssh $server $psql
```

Notes:

- If in doubt, check the actual db container name with `docker ps` on the host (compose names it
  `<project>-db-1`).
- `docker exec` + `psql` connects over the container-local socket, which the postgres image trusts
  — no password needed, and the `shieldbattery` role works directly.
- For long real runs, prefer running the `CALL` from a `tmux`/`screen` session on the host: if the
  connection drops mid-run, the in-flight batch rolls back but committed batches stay, and the
  scripts are safe to simply re-run.
- Do NOT wrap the `CALL` in an explicit transaction (`psql` `-1`/`--single-transaction`, or a
  surrounding `BEGIN`): the procedures commit internally per batch, which is impossible inside an
  outer transaction.
