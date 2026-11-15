---
name: dev-env
description: Start, health-check and stop the ShieldBattery dev stack (Node server, Rust GraphQL server, app renderer dev server, Postgres/Redis) with the dev-stack script. Use this whenever you need the servers running to verify a change, look at a web client or /dev page, or before launching the Electron app, instead of `pnpm run local-dev` (which is an interactive run-pty TUI you can't drive or read).
---

# Running the dev stack

`pnpm run local-dev` bundles every service into a `run-pty` TUI. That's great for a human but
unusable for an agent: you can't read its panes or control individual services. Use
[dev-stack.mjs](./dev-stack.mjs) instead. It works from any directory and from Git Bash or
PowerShell, and it resolves the checkout from its own location, so a copy in a git worktree drives
that worktree.

```bash
node .claude/skills/dev-env/dev-stack.mjs status                 # what is up, whose it is, is it stale
node .claude/skills/dev-env/dev-stack.mjs start                  # node + rust (enough for the web client)
node .claude/skills/dev-env/dev-stack.mjs start node rust renderer   # also the renderer, for the Electron app
node .claude/skills/dev-env/dev-stack.mjs logs node -n 80        # formatted tail of a service's log
node .claude/skills/dev-env/dev-stack.mjs restart node           # after changing server code
node .claude/skills/dev-env/dev-stack.mjs stop                   # everything dev-stack started
```

## Service map

| Service                 | Port        | What dev-stack runs                                    | Purpose                                                   |
| ----------------------- | ----------- | ------------------------------------------------------ | --------------------------------------------------------- |
| Postgres + Redis        | 5433 / 6380 | Docker `shieldbattery-db-1` / `shieldbattery-redis-1`  | DB + cache (see `.env`)                                   |
| `node` web server       | 5555        | `server/app.ts` (what `pnpm run start-server` runs)    | HTTP API + serves the web client (Vite middleware in dev) |
| `rust` GraphQL server   | 5556        | `cargo run` in `server-rs/`                            | GraphQL API (`/gql`)                                      |
| `renderer` dev server   | 5566        | Vite (what `pnpm run dev` runs)                        | Serves the Electron renderer + HMR                        |
| GraphQL codegen watch   | n/a         | not managed: `pnpm run gen-graphql --watch` (optional) | Regenerates `client/gql/` on schema change                |
| Tailscale funnel        | n/a         | not managed: `node tools/dev-funnel.mjs`               | Webhooks from a remote rp2 coordinator (see below)        |
| Electron app            | n/a         | the **verify-app** skill's `sb-app.mjs`                | The actual desktop client                                 |

Config (ports, DB creds, `DATABASE_URL`) lives in `.env`. `SB_CANONICAL_HOST` is
`http://localhost:5555`. The `renderer` is only needed for the Electron app; the web client served by
`node` at :5555 does not use it.

Other listeners you may find, which are **not** the dev stack:

- **:5527** is the integration-test container (`integration-app-server-1`) serving a production
  build. Don't test against it.
- **:6379** belongs to a different project's Redis. Ours is **6380** (`SB_REDIS_PORT`), used by both
  servers and by matchmaking's pub/sub.

## Look before you start: `status`

Run `status` first, every time. It shows, per service: up or down, the owning PID and when it
started, HTTP health, and whether dev-stack started it or it is **external** (the developer's own
`local-dev` panes, or another session's leftovers), with the external process's command line.

Two things to read from it:

- **A port that is already listening is left alone by `start`.** You will be testing against that
  process, whoever started it. A health check on the port can't tell you whose code is answering.
- **`WARNING stale:`** means the process started before the newest commit (or uncommitted edit)
  touching the code it serves. A stale server produces failures that look like bugs in your change:
  an empty or throwing lobby, `400 "clientIds" is required` on login from a freshly built app, a
  route that rejects a parameter you just added. Restart it before testing (`restart node`).

Restarting an external process needs `--force`, which prints the PID and command line it killed.
Local dev services are fine to restart without asking, but be precise and say so:

- Kill only the service that is in your way, never the whole stack.
- Tell the user when you replaced one of their processes, and again when you stop yours, since they
  may want their own back (their `local-dev` pane will show a dead process).
- **If you are a subagent, don't replace an external server unless your brief says to.** Report the
  stale warning to the parent instead.

## Start

`start` does the whole sequence and prints the final status:

1. Starts the Postgres/Redis containers if they're stopped (never prunes or recreates them).
2. Applies pending migrations (`migrations/`, the same thing `pnpm run migrate:run` does). A DB that
   is behind shows up as `500` on login or as `sqlx::query!` compile errors from `cargo run`.
3. For each requested service whose port is free: starts it detached, with output going to a log
   file, and waits until it is healthy. For the renderer, healthy means Vite has pre-bundled its
   dependencies and transformed the module graph, so an app launched afterwards doesn't come up
   blank.

Timing: `node` is healthy in about 15 s. The first `cargo run` after a Rust change compiles for
minutes (10+ from cold); run that start in the background (`run_in_background`) and wait for it to
finish rather than restarting it. `start` waits for a compile that is already in progress instead of
launching a second one.

Services started this way are **detached**: they keep running after your tool call, your turn, and
(for a subagent) your whole run. That is what lets a later step use them, and it is also why you
must stop them yourself.

## Health facts

- The Rust server answers **404 on `/`** when healthy (any HTTP response means it is up; `/gql` is
  the real endpoint). `curl -sf` treats that as a failure; don't use `-f` against it.
- The renderer listens on `[::1]` only. `localhost` works from Node and curl; a tool that resolves
  `localhost` to 127.0.0.1 only will report it down.
- Postgres: `docker exec shieldbattery-db-1 pg_isready -U shieldbattery`. To look at data:
  `docker exec shieldbattery-db-1 psql -U shieldbattery -d shieldbattery -c "<sql>"`.

## Seeding test accounts

Once `node`, `rust` and the DB are up:

```bash
pnpm run seed-dev
```

This creates `claude-admin` (all permissions) and `claude-1` through `claude-12` (plain players), all
with password `shieldbattery` and email-verified. It's idempotent, and every run also resets those
accounts' UI language to English and marks the Discord activity prompt as answered, so re-run it when
a test account has been left in another language. `claude-N` lines up with app instance N in the
**verify-app** skill. Details: `tools/seed-dev-users.ts`.

## Remote coordinator and the webhook funnel

When `SB_RP2_COORDINATOR_URL` in `.env` names a non-loopback coordinator (e.g. staging), that
coordinator delivers game-event webhooks (relay-reported results, session-closed) to this machine
through a Tailscale funnel, `node tools/dev-funnel.mjs`. The developer's `local-dev` runs it as one of
its panes, so check whether it is already up before worrying about it. It no-ops when the coordinator
is loopback.

- **Who needs it:** games between two or more humans against the remote coordinator. A single human
  against computers, and replays, have been running fine without it.
- **What its absence looks like:** no local errors. Results hang unreconciled or void, and the
  accounts can stay "in a game" on the server, so their next lobby or queue attempt fails with
  `409 AlreadyInActivity`. Restarting the Node server (`restart node`) clears the stuck accounts.
- **Starting it yourself may be refused.** It opens a public tunnel to this machine, which the
  permission system's automatic review blocks unless the user has allowed that command. If it is
  refused, don't retry or reword it: ask the user to start it (or run their `local-dev`), and say
  that multi-human game results won't reconcile until then.

## Logs

- **Services dev-stack started**: `dev-stack.mjs logs <service>` (formatted; `--raw` for the JSON).
  Files live in `%LOCALAPPDATA%\Temp\shieldbattery-dev\logs\`, with the previous run kept as
  `<service>.prev.log`. An external service has no log there; its output is in whatever terminal
  owns it.
- **Electron app + game**: `%APPDATA%\ShieldBattery-Local\logs\`
  - `app-<session>.0.log`: current Electron app log for that `SB_SESSION` (rotates to `.1`, `.2`).
    Each session gets its own log (e.g. `app-session1.0.log`), so multi-instance runs don't
    interleave. Prod / no `SB_SESSION` → `app.0.log`.
  - `game-<session>.0.log`: current in-game DLL log for that session (rotates `.0`–`.19`). Since
    only that session's game writes it, the newest run is **always `.0.log`**. The file is reused
    (line-trimmed, not truncated) across a session's launches, so grep to the last `[SESSION_START]`
    line to find the current run's boundary (that line also carries the DLL build version).

## Stopping

**When you finish a task, shut down every process you started**, unless you expect to reuse it in the
same session. Don't leave servers, the app, or side processes (rp2 coordinator/relay, a game launch)
running for the user to find and clean up later.

```bash
node .claude/skills/dev-env/dev-stack.mjs stop      # only what dev-stack started; external listeners stay
node .claude/skills/dev-env/dev-stack.mjs status    # confirm
```

- `stop` records are machine-wide (`%LOCALAPPDATA%\Temp\shieldbattery-dev\`), so it can also stop
  what an earlier session or another agent started through dev-stack.
- If you keep the stack up on purpose (more verification may be coming), say so in your reply so the
  user knows it is still running.
- **Leave Docker (Postgres/Redis) running.** Pruning volumes destroys the user's dev data.
- If a service was started some other way as a background task (`pnpm run start-server`,
  `pnpm run dev`), stopping that task kills only the pnpm wrapper and leaves the real process
  holding :5555 / :5566. Find the port's owner (`netstat -ano | grep -E ':(5555|5566)\s'`, last
  column) and `taskkill //F //T //PID <pid>`, or use `dev-stack.mjs stop <service> --force`.

## Gotchas

- Never wait with a bare `sleep N` in front of another command; the harness blocks it. `start`
  already waits for health. For anything else, poll a condition in a bounded loop, or run the long
  command in the background and wait for its completion notice.
- The dev app reads/writes `%APPDATA%\ShieldBattery-Local` (note the `-Local` suffix, the dev
  `productName`), _not_ `ShieldBattery` (the installed production client).
- StarCraft is installed at `C:\Program Files (x86)\StarCraft`; the dev settings files already point
  there, so game launches work without extra setup.
- The scripts resolve the checkout from their own location, so always run the copy inside the
  checkout you are testing. A worktree whose history predates them doesn't have them: copy
  `dev-env/dev-stack.mjs`, `dev-env/stack-common.mjs` and `verify-app/sb-app.mjs` into the same
  paths there rather than running the main checkout's copy (which would start the main checkout's
  code).
