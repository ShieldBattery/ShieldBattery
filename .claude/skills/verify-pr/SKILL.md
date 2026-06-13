---
name: verify-pr
description: Decide what to actually run to verify a change or review a PR, scaled to what changed — from lint/typecheck up to a full game launch that checks MMR/results. Use when reviewing a PR, validating a branch, or confirming a change works before pushing. Maps changed paths to the minimum sufficient verification tier and holds per-feature recipes.
---

# Verifying a change / reviewing a PR

The goal: run the **minimum sufficient** set of checks for what changed. A CSS tweak does not need a
game launch; an MMR change does. Start by looking at the diff:

```bash
git diff --stat $(git merge-base HEAD master)   # or the PR base
```

Map the touched paths to tiers below, run the union of what they require, and report results
honestly (paste failures; say what you skipped and why).

## Universal checks (almost always)

```bash
pnpm run lint           # eslint + prettier;  add --fix to autofix
pnpm run typecheck      # tsc over the whole project
pnpm exec vitest run <path>   # unit tests near the change (use `run`, not bare `vitest` = watch)
```

Skip these only for pure non-code changes (docs/markdown, assets).

## Verification tiers

| Tier | What it means | How |
| --- | --- | --- |
| **T0 Static** | lint, typecheck, unit tests | commands above |
| **T1 Visual** | component renders correctly | browser on a `/dev` page — CSS/layout only |
| **T2 App** | feature works in the real client | drive one Electron instance (**verify-app**) |
| **T3 Multi** | interaction between users | two+ Electron instances (**verify-app**) |
| **T4 Game** | end-to-end in-game outcome | launch a real match, verify DB + UI (below) |

T1 is the weak tier — it only proves rendering, because `/dev` pages use mock data and no store.
Anything about *behavior* needs T2+.

## Changed-path → tier matrix

| Changed path | Run |
| --- | --- |
| `*.md`, docs, comments only | nothing (maybe lint) |
| Styles/CSS/`styled-components`/layout only | T0 + T1 |
| `client/` feature logic, reducers, atoms, hooks | T0 + T2 |
| Multiplayer client features (chat, whispers, lobbies, parties, matchmaking, social) | T0 + T3 |
| `server/lib/<feature>` | T0 + the feature's vitest; integration subset if specs cover it (below) |
| `server/` auth / session / websockets | T0 + T2 (login + a socket-backed view) and/or integration |
| `server-rs/` | T0 + Rust checks (below); `pnpm gen-graphql` if schema changed |
| DB migration (`migrations/`) | run it (`pnpm run migrate:run`) + exercise affected flows; `pnpm run sqlx-prepare` |
| `game/` (Rust DLL) | Rust game checks (below); **T4** if it touches results/netcode/sync/replays |
| MMR / results / ranks / match-history logic (client, `server`, or `game`) | **T4** + DB outcome checks |
| `app/` (Electron main) | T0 + T2 smoke: boots, logs in, settings open, game path detected |
| `common/` | T0 (it fans out everywhere — typecheck is load-bearing) + tests of touched dependents |

When several rows apply, run the union. When unsure whether logic is reachable from the UI, prefer
the higher tier.

## Area-specific commands

**Integration tests** (Playwright against a throwaway Docker stack on :5527, separate from your dev
stack):
```bash
.\run-integration-tests.bat                 # full (rebuilds the app server container)
.\run-integration-tests.bat nobuild         # skip rebuild when only test code changed
.\run-integration-tests.bat nobuild chat.spec.ts   # a subset; extra args pass through to Playwright
```

**Rust GraphQL server** (`server-rs/`):
```bash
cd server-rs && cargo check
cd server-rs && cargo clippy --all-targets --workspace -- -D warnings
cd server-rs && cargo test
pnpm run sqlx-prepare    # after changing SQL queries
pnpm run gen-graphql     # after changing the GraphQL schema (regenerates client/gql)
```

**Game DLL** (`game/`):
```bash
game\build.bat           # debug 32-bit (default; what the app injects in dev)
game\build.bat x86_64    # debug 64-bit
cd game && cargo clippy --all-targets --workspace -- -D warnings
cd game && cargo test
```

## T4: game-launch / outcome verification

This tier exists because the important questions are about *outcomes*, not just "did the game open":
does MMR update correctly, is the result recorded, does match history/replay upload work. Verifying
the launch alone is not enough.

**Setup**: dev stack up incl. webpack dev server; `game\build.bat` has produced a current DLL;
two app instances logged in as two seeded accounts (see **verify-app**).

**Drive a match**:
1. Queue both clients into 1v1 matchmaking on the same type + map pool (or host a 2-player lobby vs.
   the other client). A match is found → both clients count down and launch StarCraft.
2. Confirm the game actually started and our DLL injected:
   - `StarCraft.exe` is running (one process per client).
   - `%APPDATA%\ShieldBattery-Local\logs\shieldbattery.0.log` shows the in-game session starting (a
     fresh `------` separator block is written at launch; a new file in the `.0`–`.19` set per
     concurrent game).
3. Force a decisive finish quickly — end the game on one side (quit / leave / surrender, or kill one
   `StarCraft.exe`). The losing client drops, the other is credited the win, and results report
   through the game DLL (with the Electron app as fallback).

**Verify outcomes** — UI *and* the database (`DATABASE_URL` in `.env`):
- Post-game results screen shows the correct win/loss for each client.
- `games` + `games_users` — a row for the match with the right players/result.
- `matchmaking_rating_changes` — a rating-change row per player for this game (the deltas).
- `matchmaking_ratings` — each player's current rating/points moved in the right direction.
- `user_stats` — win/loss counters incremented.
- Match history view (profile) lists the game; replay upload succeeded if that's in scope.

**Cleanup**: ensure no orphan `StarCraft.exe` remains; detach playwright-cli; stop app instances.

> The exact fastest-decisive-finish mechanism and the precise log success-strings are worth pinning
> down on the first real run and recording in the recipe log below, so later runs are turnkey.

## Per-feature recipe log (living)

Append a tested recipe here whenever you verify a feature, so the next run is faster. Format:
**Feature — tier — steps — where to confirm.**

- **Login (Electron, T2)** — verified 2026-06-13. Stack up incl. webpack :5566;
  `SB_HOT=1 SB_SESSION=session1 npx electron app --remote-debugging-port=9222`;
  `npx --no-install playwright-cli -s=c1 attach --cdp=http://localhost:9222`. App opens on the home
  screen logged out → click the top-bar **"Log in"** button (opens an overlay, URL stays
  `shieldbattery://app/`) → fill `input[name=username]` / `input[name=password]` → click
  `button[data-test=submit-button]`. Confirm via `[data-test=app-bar-user-button]` textContent
  (shows e.g. `claude-1Novice`). Full mechanics in the **verify-app** skill.
- **Two-client matchmaking queue (T3)** — exercised 2026-06-13 on PR #1286 (Rust matchmaker). Two
  instances (`session1`/`session2`, ports 9222/9223) logged in as `claude-1`/`claude-2`. Navigate
  each to matchmaking by clicking `a[href="/play/"]` (lands on `/play/matchmaking`); the "Find match"
  button is enabled once a default race is set. Click it on both. **Where to look:**
  - UI queue state: `document.body.innerText` matches `Searching`.
  - server-rs received the enqueues: its log shows `POST /matchmaker` (one per find); `GET
    /matchmaker/token` every ~5s is the Node→Rust restart watchdog (healthy, ignore).
  - Redis (port 6380): `sbthrottle:matchmaking~<userId>` keys appear per queued user (the matcher's
    own queue is in-memory in server-rs, so don't expect queue keys there).
  - A formed match writes `matchmaking_completions` + `games`/`games_users` (none ⇒ no match yet).
  - Note from this run: two equal-rated (unrated) players did **not** match within ~70s; enqueue
    reached Rust but no match was delivered. Couldn't fully attribute (matcher tick/threshold vs.
    delivery vs. dev timing) without debug logging on the Rust matcher — flag for the author rather
    than asserting a bug.
