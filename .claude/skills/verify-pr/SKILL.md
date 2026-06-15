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

**Pick the cheapest launch path for what you're verifying.** A 2-player **custom lobby** is faster
and simpler than matchmaking — no ~30s matchmaker wait, no short-fused ready-up window, no
matchmaking-ban risk on a fumbled attempt. It still creates a real `games`/`games_users` record,
registers `selected_matchup`, and reconciles results (incl. `assigned_matchup`, win/loss, replays,
match history). So use a lobby whenever the thing under test isn't matchmaking-specific. Only go
through matchmaking when you actually need a matchmaking outcome: MMR/rank changes,
`matchmaking_rating_changes`, bonus pool, season/placement logic, party-queue, or the matchmaker
itself. (Lobby launch mechanics — `c1` hosts, `c2` joins, host starts — are in the **verify-app**
skill's lobby flow; the DLL-rebuild and finish/outcome steps below apply to both paths.)

**Setup** (validated 2026-06-13 — read these, they each cost a failed run):
- Dev stack up incl. webpack dev server; two app instances logged in as two seeded accounts (see
  **verify-app**).
- **Rebuild the game DLL first**: `cmd /c "game\build.bat debug"` (from PowerShell; the bare
  `cmd /c game\build.bat` from Git Bash opens cmd interactively and does nothing). A stale
  `game/dist/shieldbattery.dll` **crashes StarCraft at game-start with `0xc0000005`** (Forge graphics
  init) even when only a trivial source line changed — always build a current DLL. The running app
  injects `game/dist/shieldbattery.dll` at launch, so no app restart needed after a rebuild.

**Drive a match**:
1. Arm a ready-up auto-clicker on **each** client *before* queuing — the "Ready up" window is short
   and polling-then-clicking is too slow (a missed ready-up cancels the match AND bans you, below):
   `playwright-cli -s=cN run-code "async page => { await page.getByRole('button', { name: 'Ready up' }).click({ timeout: 150000 }); }"`
   (run in background, one per client).
2. Queue both: navigate each to `/play/` (lands on `/play/matchmaking`), then
   `playwright-cli -s=cN click "getByRole('button', { name: 'Find match', exact: true })"`. Two
   equal/unrated players match in ~30s; the armed clickers ready both up instantly.
3. Confirm launch + injection:
   - Two `StarCraft.exe` processes (`tasklist | grep StarCraft`).
   - `%APPDATA%\ShieldBattery-Local\logs\shieldbattery.0.log` (+`.1`): `All players have joined` →
     `Readying lobby for start` → **`Forge: Game started`** = really in-game.
   - App log (`app.0.log`): `Game status updated to 'configuring'` → `'playing'`.
4. Decisive finish: `Stop-Process` one `StarCraft.exe`. The other is credited the win; the result
   reports (the killed DLL fails to send, then `Game failed to send result, retrying from the app` →
   `Game result resent successfully` — the Electron fallback).

**Verify outcomes** — UI *and* DB (`docker exec shieldbattery-db-1 psql -U shieldbattery -d shieldbattery`):
- `games`/`games_users` — a row with results for the match.
- `matchmaking_rating_changes` — a delta row per player.
- `matchmaking_ratings` — rating moved (winner up, loser down), `wins`/`losses`/`num_games_played`.
- `user_stats`, match history (profile), replay upload if in scope.

**⚠ Bans escalate machine-wide.** Every failed ready-up / abrupt abort records a `matchmaking_bans`
row keyed by *client identifier* (matched with `minSameIdentifiers=1` in dev) — so it bans BOTH
local instances and escalates (warning → 15m → 30m …). Between messy attempts:
`DELETE FROM matchmaking_bans;` (dev only). Symptom when banned: clicking Find match shows a "Banned
from matchmaking" dialog instead of searching.

**Cleanup**: `Stop-Process` any orphan `StarCraft.exe`; clear test `matchmaking_bans`; detach
playwright-cli; stop app instances + servers; leave Docker.

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
- **Full game launch → MMR (T4)** — validated end-to-end 2026-06-13 on **master**. Followed the T4
  section above. Confirmed the whole pipeline: match (~28s) → auto ready-up → 2 `StarCraft.exe` →
  DLL injection → rally-point networking → both join lobby → `Forge: Game started` → app status
  `playing` → killed one process → result reported via the Electron fallback → winner's MMR moved
  (1500 → ~1758). Two findings: (1) the stale DLL crashed at game-start with `0xc0000005`; a fresh
  `game\build.bat debug` fixed it (rebuild is now step 0 of the T4 setup). (2) result reconciliation
  then failed with `duplicate key ... matchmaking_rating_changes_pkey` at
  `server/lib/games/game-result-service.ts:527` (`maybeReconcileResults`) and rolled back, so the
  result/MMR did **not** durably finalize. Same error class also hit a months-old stuck game, so it
  looks like a real idempotency gap (plausibly the DLL+app dual result-report both inserting) — but
  an abrupt process-kill is an abnormal finish, so worth reproducing with a clean in-game surrender
  before asserting a bug. Flag for the author.
- **Match-history filtering + matchup columns (T0 + DB/SQL layer)** — verified 2026-06-15 on PR #1281
  (`game-filters`). Adds `games.selected_matchup`/`assigned_matchup`, a filter bar, and an
  out-of-band backfill (`tools/backfill-matchups.sql`). For column/migration/backfill PRs the
  DB layer is the high-value tier and is checkable without a game launch:
  - T0: `pnpm run lint` / `typecheck` / `vitest run common/games/matchups.test.ts` (51 tests) all green.
  - Migration applies cleanly on a throwaway **schema** (the `shieldbattery` DB user can't
    `CREATE DATABASE`): `CREATE SCHEMA migtest; SET search_path TO migtest;` + a stub `games` table,
    then run the migration DDL, assert only the intended index exists, `DROP SCHEMA ... CASCADE`.
  - Backfill: install the procedure (`docker exec -i shieldbattery-db-1 psql ... < tools/backfill-matchups.sql`),
    `CALL backfill_matchups(dry_run => true)` — "0 of N would change" proves idempotency over real
    data (dev DB happened to hold all edge cases: a legacy non-array `{}` results row, NULL-results
    rows, games-with-computers, random→assigned resolution, multi-team/asymmetric). Spot-check rows
    by hand against config/results. **`DROP PROCEDURE backfill_matchups(int, boolean)` when done.**
  - Filter SQL: run the WHERE fragments directly — `selected_matchup ~ '^[prtz]{N}-[prtz]{N}$'`
    (format) and `assigned_matchup = ANY(ARRAY[...])` (matchup) — and eyeball counts.
  - Dev-DB drift seen: it carried a stale `idx_games_selected_matchup` from an earlier version of the
    migration; the merged migration only creates `idx_games_assigned_matchup` (confirmed via the
    fresh-schema test). Not a PR bug.
  - T2 (drive the filter bar in Electron) — done 2026-06-15. Navigate to a rich profile's match
    history via `document.querySelector('a[href="/play/"]')`-style nav or, for profiles,
    `history.pushState(null,'','/users/1/2Pacalypse-/match-history')` (wouter picks it up; may need a
    second try + a tick). The basic chips (Ranked/Custom/duration/sort) apply immediately; **Format +
    Matchup live in the "Advanced" popover with DRAFT state and only apply on the "Apply" button**
    (selecting a format just reveals the matchup race-picker). Verified the full round trip by reading
    `location.search`, `playwright-cli requests | grep match-history` (confirms the query string —
    `?ranked=true&format=2v2&matchup=pt-pz&offset=0`, proving the `URLSearchParams` interpolation into
    `apiUrl` is NOT double-encoded), and the on-screen result counts narrowing correctly.
  - T4 (launch a game to confirm the live writes) — done 2026-06-15. Standard two-client matchmaking
    launch (see the T4 section). Confirmed **`registerGame`→`selected_matchup`** is written the moment
    the game row is created (`r-r` for two random-race players) and **`maybeReconcileResults`→
    `assigned_matchup`** is written at reconciliation (`p-p` after random resolved). Note: forcing the
    finish by killing BOTH StarCraft processes yields a *disputed* result (both `unknown`) which skips
    the MMR block — but `assigned_matchup` is computed OUTSIDE that block, so it's still written
    correctly; the disputed path is a fine way to validate the matchup write without depending on a
    clean win. The `matchmaking_rating_changes_pkey` dup-key error still appears in the server log but
    it's the 15-min scheduled job choking on a *different* months-old stuck game — unrelated.
- **Channel user permissions (T3)** — verified 2026-06-15 on PR #1280 (`user-channel-permissions`).
  Three clients (`session1/2/3`, ports 9222/23/24) as `claude-1/2/3`. Setup: c1 creates a channel
  via the chat-list "Create channel" button → becomes owner (channel row in DB has `owner_id`);
  others join via chat-list **search box** (`textbox "Search"`, type the exact name) → click the
  row's **Join** button (direct URL nav does *not* join; clicking the compact list row does *not*
  join — only the search-result Join button does). Open the permissions UI: channel-header **"More
  actions"** (`more_vert`) → **"Channel settings"** → **"Users" → "Permissions"** nav entry; click a
  user row → permission-checkbox dialog → Save. **Where to confirm:**
  - DB truth: `channel_users` columns `kick/ban/edit_permissions/change_topic/toggle_private` per
    `(channel_id, user_id)`. Owner authority is the `channels.owner_id`, not a flag.
  - Save round-trips to those columns; the permissions list/badges reflect saved perms.
  - **Access gating** (channel-header + settings nav): a `kick`-only member gets NO "Channel
    settings"; granting `editPermissions` makes "Channel settings" appear **live** (via the
    `permissionsChanged` socket event) and shows only the "Users → Permissions" page (General is
    owner/admin-only).
  - **Row disable logic** for a delegated moderator (has `editPermissions`, not owner/admin): owner
    row disabled, own row enabled, another-moderator row disabled — mirrors the server
    `updateUserPermissions` guard.
  - **Live `userProfileChanged` propagation** (the headline cross-client behavior): isolate it by
    keeping a delegated-mod's user **context menu open** (right-click a user in the member list) on
    one client, then promote that target to moderator (grant `kick`) from the owner's client. The
    menu's "Kick"/"Ban" item flips **enabled→disabled with zero interaction** on the observing client
    (the menu's `useEffect` only re-fetches on open, so a flip while open can only come from the
    pushed event). Note: the kick/ban menu disable is per-action now (`kick` enables Kick, `ban`
    enables Ban — they're independent). Redux store is NOT on `window`; verify via UI surfaces + DB.
  - All static checks were clean (typecheck, lint, 102 chat-service unit tests covering every new
    auth path). No bugs found.
