---
name: dev-env
description: Start and health-check the ShieldBattery dev stack (Node server, Rust GraphQL server, webpack dev server, Electron app) as individually-controllable background processes. Use this whenever you need the app or servers running to verify a change, instead of `pnpm run local-dev` (which is an interactive run-pty TUI you can't drive or read).
---

# Running the dev stack

`pnpm run local-dev` bundles every service into a `run-pty` TUI. That's great for a human but
unusable for an agent — you can't read its panes or control individual services. Start each service
as its own background process instead. This skill is the source of truth for ports, start commands,
health checks, and logs.

## Service map

| Service | Command (from repo root) | Port | Purpose |
| --- | --- | --- | --- |
| Postgres + Redis | `docker-compose up -d` | 5433 / 6379 | DB + cache (see `.env`) |
| Node web server | `pnpm run start-server` | 5555 | HTTP API + serves the web client (webpack-dev-middleware in dev) |
| Rust GraphQL server | `cargo run` in `server-rs/` | 5556 | GraphQL API (`/gql`) |
| Webpack dev server | `pnpm run dev` | 5566 | Electron renderer bundle + hot reload |
| GraphQL codegen watch | `pnpm run gen-graphql --watch` | — | Regenerates `client/gql/` on schema change (optional) |
| Electron app | `pnpm run app` (or see verify-app) | — | The actual desktop client |

Config (ports, DB creds, `DATABASE_URL`) lives in `.env`. `SB_CANONICAL_HOST` is `http://localhost:5555`.

## Start order

1. **Postgres + Redis** must be up first. They're usually already running on this machine — check
   before starting:
   ```bash
   docker ps --format '{{.Names}}\t{{.Ports}}'
   ```
   If nothing is bound to 5433/6379, bring them up: `docker-compose up -d` (from repo root). After a
   fresh start, run migrations: `pnpm run migrate:run`.
2. **Node server** and **Rust server** can start in parallel. The Node server needs the Rust server
   for some flows (e.g. signup validates the username against it), so bring both up before testing.
3. **Webpack dev server** is only needed if you're going to launch the Electron app (it serves the
   renderer bundle). The web client served by the Node server at :5555 does *not* need it.

Start each as a **background** process so it keeps running across turns. Example:

```bash
# Node web server (logs are piped through pino-pretty by the npm script)
pnpm run start-server   # run_in_background: true

# Rust GraphQL server — run cargo directly; the run-dev-server.bat wrapper just pipes to bunyan
#   (cd into server-rs in the same command; the cwd doesn't persist for background procs)
cd server-rs && cargo run
```

> First `cargo run` after a Rust change can take minutes to compile. Expect the :5556 health check
> to fail until it finishes — watch the background output rather than restarting it.

## Health checks

Don't assume a service is up because the start command returned. Poll the port:

```bash
# Node HTTP server (expect 200/redirect)
curl -sf -o /dev/null -w '%{http_code}\n' http://localhost:5555/

# Rust GraphQL server
curl -sf -o /dev/null -w '%{http_code}\n' http://localhost:5556/

# Postgres
docker exec <pg-container> pg_isready -U shieldbattery     # or: pnpm run seed-dev hits it
```

Or just check listeners (Windows): `netstat -ano | findstr ":5555 :5556 :5433 :6379"`.

## Seeding test accounts

Once the Node + Rust servers and the DB are up, create known login accounts:

```bash
pnpm run seed-dev
```

This creates `claude-admin` (all permissions) and `claude-1`/`claude-2`/`claude-3` (plain players),
all with password `shieldbattery`, all email-verified. It's idempotent — safe to re-run. The three
numbered accounts line up with the `SB_SESSION=session1..3` app instances used for multi-client
tests (see the **verify-app** skill). Details: `tools/seed-dev-users.ts`.

## Logs

- **Servers**: read the background process output (the IDs returned when you launched them).
- **Electron app + game**: `%APPDATA%\ShieldBattery-Local\logs\`
  - `app.0.log` — current Electron app log (rotates to `.1`, `.2`). **Shared across all running app
    instances** — `SB_SESSION` separates settings and session storage but not this log, so
    multi-instance runs interleave here.
  - `shieldbattery.0.log` — current in-game DLL log (rotates `.0`–`.19`; a new launch picks the
    first free file, so concurrent games land in different files).

## Stopping

Kill the background processes you started (the harness tracks them). Leave Docker (Postgres/Redis)
running unless you specifically need a clean DB — pruning volumes destroys your dev data.

## Gotchas

- `cd` doesn't persist between background launches; put the `cd server-rs &&` in the same command.
- The dev app reads/writes `%APPDATA%\ShieldBattery-Local` (note the `-Local` suffix — that's the
  dev `productName`), *not* `ShieldBattery` (the installed production client).
- Starcraft is installed at `C:\Program Files (x86)\StarCraft`; the dev settings files already point
  there, so game launches work without extra setup.
