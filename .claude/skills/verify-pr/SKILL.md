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
4. Decisive finish — two paths:
   - **Human graceful leave (reliable, needs a person at the keyboard).** Ask the user to leave the
     match *through the in-game menu* (F10 / Menu → Quit/Leave Game → Yes) on the loser's window —
     **not** by closing the window / Alt-F4 / killing the process. A graceful leave ends the game
     normally on the opponent's side (no dropped-player dialog to hang on), so both DLLs report a
     decisive result → clean winner-up/loser-down MMR. This is the way to get a real MMR delta in
     this env (validated PR #1286, both 1v1 and 2v2). For **2v2**, the whole losing *team* must
     leave: have the user leave both of one team's windows.
   - **`Stop-Process` one `StarCraft.exe` (unattended fallback).** The other is *supposed* to be
     credited the win, but in practice the survivor often hangs on BW's dropped-player dialog with no
     human to dismiss it → both report `unknown` → game reconciles **disputed**, no MMR (see Known
     issues). Use only when no human is available and you don't need the MMR delta.

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

## Per-feature recipes (living)

Each entry is the reusable **mechanics** for verifying a feature — selectors, navigation, where to
look, SQL — so the next run skips the trial-and-error. When you verify something, fold the durable
bits in here, and keep this lean:

- **No run reports.** Don't append "MMR moved 1500→1758 on PR #1286" narration — that doesn't help
  the next run. Record the *how*, not the *what-happened*.
- **Don't repeat verify-app.** Launch, login, CDP attach, two-client login, and reading
  logs/console/requests/DB all live in the **verify-app** skill — reference it, don't copy it.
- **Findings ≠ recipes.** A surprising-but-unconfirmed observation goes under *Known issues* below
  (and gets deleted once resolved), not woven into a recipe.

- **Matchmaking queue (T3).** Navigate each client to matchmaking by clicking `a[href="/play/"]`
  (lands on `/play/matchmaking`). Confirm:
  - UI: `document.body.innerText` matches `Searching`.
  - server-rs log: `POST /matchmaker` per find. (`GET /matchmaker/token` every ~5s is the Node→Rust
    restart watchdog — healthy, ignore.)
  - Redis (:6380): a `sbthrottle:matchmaking~<userId>` key per queued user. The matcher's own queue
    is in-memory in server-rs, so no queue keys land in Redis.
  - A formed match writes `matchmaking_completions` (`completion_type='found'`, one row per player) —
    this lands the instant the match forms, *before* the `games` row (created at game load). No
    `found` rows ⇒ no match yet.
  - Since the Rust matcher (PR #1286+), two players that are **rating-equal** match on the **first
    ~6s tick** (adaptive threshold relaxes for small queues). The seeded accounts are *not* equal —
    they carry real ratings from prior test games (e.g. 1567 vs 1327), and the quality formula
    (unchanged since #1286) can stall a ~240-point gap for minutes. To force a fast clean match,
    equalize first: `UPDATE matchmaking_ratings SET rating=1500, uncertainty=350, volatility=0.06
    WHERE user_id IN (...) AND matchmaking_type='<mode>';` then queue.
  - **Multi-queue UI (PR #1288+).** `/play/matchmaking` is a **multi-select checkbox list**, not
    buttons/tabs: three `input[type=checkbox]` in fixed order **[0]=1v1, [1]=1v1 Fastest, [2]=2v2**.
    Check one or more, then the single **"Find match"** button (`getByRole('button',{name:'Find
    match',exact:true})`) queues for *all* checked types at once. A player checked for N types shows
    `queue_size{matchmaking_type=...} 1` for **each** of those N (the `/metrics` gauge is the
    cleanest multi-queue proof). When they match in one mode they're pulled from **all** their
    queues (queue drains fully), and only the *matched* mode writes a `found` completion — the other
    queued modes are abandoned with no completion. **Cancel**, by contrast, writes one
    `cancel`/`disconnect` completion per queued type. After a game a **"Match results" dialog** stays
    open and silently blocks the next Find match — close it with the **"Close dialog"** button before
    re-queuing.
  - **playwright-cli in this Electron app: drive clicks in-page, not via role/CSS `click`.** The
    `click` command's actionability wait routinely times out here (login submit, checkboxes, Find
    match). Reliable pattern: `eval "(()=>{const b=[...document.querySelectorAll('button')]
    .find(b=>/^\s*Find match\s*$/.test(b.textContent)); if(b&&!b.disabled){b.click(); return 'ok'}
    return 'no'})()"`. Two gotchas: (1) `eval` wraps input as `() => (<expr>)`, so a statement with
    `;` is a SyntaxError — use a single-expression IIFE; (2) the checkboxes are MUI and re-render on
    each toggle, so clicking several from one captured `querySelectorAll` array hits stale nodes and
    toggles the wrong boxes — click **one index at a time, re-query each time, and verify+retry**.
    For ready-up auto-clickers, `run-code`'s Node scope lacks `setTimeout` — poll with
    `await page.waitForTimeout(250)`.
  - server-rs restart watchdog: queue a player, kill the `cargo run` on :5556 and restart it (new
    process → new `/matchmaker/token` UUID). Within ~10s Node logs `failed to fetch ... process
    token — will retry` then `Rust matchmaker restart detected — surfacing failure`, ejects searching
    players, and the client shows the **"Matchmaking error — interrupted due to a server error"**
    dialog (the new `matchmakingServiceError`). Mid-match players are deliberately spared.
  - Restored gauge: `curl -s localhost:5555/metrics | grep shieldbattery_matchmaker_queue_size`
    (direct GET only — an `x-forwarded-for` header 403s) reflects live `queueEntries` per type; the
    label disappears when the queue empties.

- **2v2 matchmaking (T4, 4 clients).** Needs 4 distinct accounts/instances. Sessions 1–3 are
  pre-configured; clone a 4th: copy `%APPDATA%\ShieldBattery-Local\{settings,scr-settings,CSettings}-session3.json`
  to `-session4.json`, then launch `SB_SESSION=session4 ... --remote-debugging-port=9225`. Log all 4
  in (claude-1/2/3/admin), check the **2v2** box (checkbox idx 2; see multi-queue note above) on
  each, arm a ready-up clicker per client, queue all 4 →
  the matcher splits them into two balanced teams (`config->'teams'` is `[[a,b],[c,d]]`; game is
  `gameType: topVBottom`). The **race draft** then runs but **auto-completes**: each pick auto-locks
  the player's provisional (queued) race after `DRAFT_PICK_TIME_MS`+2s (=17s), so you can leave it
  untouched — no need to drive picks. Game loads + 4 `StarCraft.exe` launch. Clean finish: user
  leaves *both* losing-team windows (graceful, see T4 step 4). Outcome: 2 win / 2 loss rows in
  `games_users`, 4 `matchmaking_rating_changes` rows (type `2v2`), `assigned_matchup` like `pt-zz`.

- **Channel user permissions (T3).** Three clients exercise delegation cleanly (owner + delegated
  moderator + target). Setup: c1 creates a channel via the chat-list **"Create channel"** button →
  becomes owner (`channels.owner_id`); others join via the chat-list **search box**
  (`textbox "Search"`, type the exact name) → the result row's **Join** button. *Joining gotcha:*
  direct URL nav doesn't join, and clicking the compact list row doesn't join — only the
  search-result Join button does. Open the permissions UI: channel-header **"More actions"**
  (`more_vert`) → **"Channel settings"** → **"Users" → "Permissions"** → click a user row →
  checkbox dialog → Save. Confirm:
  - DB truth: `channel_users` columns `kick`/`ban`/`edit_permissions`/`change_topic`/`toggle_private`
    per `(channel_id, user_id)`; owner authority is `channels.owner_id`, not a flag. Save round-trips
    to these columns. The Redux store is **not** on `window`, so verify via UI surfaces + DB.
  - Live access gating via the `permissionsChanged` socket event: a `kick`-only member gets no
    "Channel settings"; granting `editPermissions` makes it appear **without reload** and shows only
    "Users → Permissions" (General is owner/admin-only).
  - Delegated-moderator row-disable (has `editPermissions`, not owner/admin) mirrors the server
    `updateUserPermissions` guard: owner row disabled, own row enabled, another-moderator row disabled.
  - Live `userProfileChanged` propagation (the headline behavior): keep a target's user **context menu
    open** (right-click them in the member list) on one client, then grant `kick` from the owner's
    client — the menu's "Kick" item flips enabled→disabled with zero interaction. (The menu only
    re-fetches on open, so an in-place flip can only be the pushed event.) Disable is per-action —
    `kick` enables Kick, `ban` enables Ban, independently.

- **DB migrations & backfills (column PRs).** The DB layer is the high-value tier here and is
  checkable without a game launch:
  - Apply the migration on a throwaway **schema** (the `shieldbattery` user can't `CREATE DATABASE`):
    `CREATE SCHEMA migtest; SET search_path TO migtest;` + stub the tables it touches, run the
    migration DDL, assert the intended objects exist, `DROP SCHEMA migtest CASCADE`. Trust this over
    the live dev DB, which can carry **stale objects from earlier iterations of the same migration**
    (e.g. an index the merged version renamed) — that drift is not a PR bug.
  - Backfill idempotency: install the procedure
    (`docker exec -i shieldbattery-db-1 psql ... < tools/<backfill>.sql`), then
    `CALL <backfill>(dry_run => true)` — "0 of N would change" proves idempotency over real data.
    Spot-check a few rows by hand. **`DROP PROCEDURE` when done.**
  - Filter/predicate SQL: run the WHERE fragments directly and eyeball counts (e.g. a format regex
    `col ~ '^[prtz]{N}-...'`, a membership test `col = ANY(ARRAY[...])`).

- **Match-history filter bar (T2).** Reach a profile's match history with
  `history.pushState(null,'','/users/<id>/<name>/match-history')` (wouter picks it up; may need a
  second try + a tick). Basic chips (Ranked/Custom/duration/sort) apply immediately; **Format +
  Matchup live in the "Advanced" popover as DRAFT state and only commit on "Apply"** (picking a
  format is what reveals the matchup race-picker). Verify the round trip with `location.search` +
  `playwright-cli -s=cN requests | grep match-history` — the query string (e.g.
  `?ranked=true&format=2v2&matchup=pt-pz&offset=0`) confirms `URLSearchParams`→`apiUrl` isn't
  double-encoding.

- **Matchup columns on game results (T4).** `registerGame` writes `selected_matchup` when the `games`
  row is created (e.g. `r-r` for two random-race players); `maybeReconcileResults` writes
  `assigned_matchup` at reconciliation (e.g. `p-p` once random resolves). Handy: `assigned_matchup` is
  computed **outside** the MMR block, so a *disputed* result (kill BOTH `StarCraft.exe` → both players
  `unknown` → MMR block skipped) still writes it — a cheap way to validate the matchup write without
  engineering a clean win.

- **Game results page navigation.** `/games/:id` routes take a **pretty ID** (base64url UUID, 22
  chars), not the raw UUID — a raw UUID crashes the route ("Invalid pretty ID") into the app error
  screen (recover: click "Reload app"). Encode:
  `node -e "console.log(Buffer.from('<uuid-no-dashes>','hex').toString('base64').replace(/\+/g,'-').replace(/\//g,'_').substring(0,22))"`.
  Navigate with the pushState IIFE (below), give it ~2.5s to lazy-load.

- **GraphQL API as a specific user.** The URQL client authenticates to :5556/gql with a **JWT
  Bearer header**, not cookies — a bare in-page `fetch(..., {credentials:'include'})` from the
  `shieldbattery://` origin runs **anonymous** (silently! you'll get FORBIDDEN and misattribute
  it). Grab the token from the client's storage and attach it:
  `const k=Object.keys(sessionStorage).concat(Object.keys(localStorage)).filter(k=>k.includes('sbjwt')); const jwt=sessionStorage.getItem(k[0])??localStorage.getItem(k[0])`
  → `fetch('http://localhost:5556/gql',{method:'POST',headers:{'content-type':'application/json','Authorization':'Bearer '+jwt},body:JSON.stringify({query,variables})})`.
  Ideal for guard/negative tests (typed error codes land in `errors[0].extensions.code`). Note
  `playwright-cli eval` wraps input as `() => (<expr>)` — statements with `;` are a SyntaxError;
  use a single-expression IIFE (async IIFE works; returned promises are awaited).

- **Game reporting (T3, reporter + admin clients).** Needs a finished game both seeded users played
  (the dev DB usually has one; else play a lobby game first). Reporter side: results page →
  `flagReport` button (participants only — non-participants see no button) → dialog: Player select
  lists the *other* humans; picking **Other** flips Details to required with a live error; submit →
  "Report submitted." snackbar → row in `game_reports` (reasons stored snake_case: `griefing`,
  `abandoning`...). Re-report same target → "You've already reported this player for this game."
  Admin side: grant via the **Manage game reports** checkbox (`/users/:id/:name/admin`, save via
  `button[data-test=save-permissions-button]`), **reload the client** to pick up own-permission
  changes, then `/admin/game-reports`: list defaults to unresolved-only ("Include resolved"
  checkbox), row click → detail with per-user credibility stat tiles, View game/Download/
  Watch replay (Watch launches SC:R with the replay — real T4-ish signal; kill SC after),
  notes + one of 4 resolve buttons → `resolved_at`/`resolver_id`/`resolution` in DB, and a
  "Restrict this reporter" button (resolved reports only) → punishments page where kind
  `reporting` + a **future end-time**
  (fill the datetime-local via playwright `fill`, not the native setter — form state misses it)
  applies a `user_restrictions` row; the reporter gets a live notification and further submits get
  "You are currently restricted from reporting." Server edge codes (test via JWT fetch as the
  reporter): self-report/target-not-in-game → `BAD_REQUEST`, nonexistent-game/reporter-not-in-game
  → `FORBIDDEN`, ≥10 reports in the last hour → `RATE_LIMITED` (synthesize rows:
  `INSERT INTO game_reports (game_id, reporter_id, reported_user_id, reason) SELECT id, <uid>, <target>, 'griefing' FROM games ... LIMIT n` —
  participation isn't DB-enforced; delete after). In dev the replay URL has **no
  Content-Disposition** (Local FileStore can't set headers — documented, not a bug; Spaces sets it).

### Known issues / open questions (prune when resolved)

Unconfirmed oddities seen during verification — heads-ups, not asserted bugs. Reproduce on a clean
path before treating one as real; delete it once resolved.

- **`matchmaking_rating_changes_pkey` dup-key in reconciliation logs** (seen 2026-06-13/15). Two
  requests reconciling the same game can collide on `matchmaking_rating_changes`. The normal submit
  path already treats this as benign (its catch logs `info`: "another request already updated rating
  information"). The 15-min scheduled `reconcileIncompleteResults` job runs the same code with
  `force` but its `try/catch` logs *any* failure as a generic `error`, so stale "stuck" games surface
  it as an alarming line. Reads as expected idempotency, not a bug; if worth quieting, mirror the
  submit path's dup-key downgrade in the job's catch. (Symbols in
  `server/lib/games/game-result-service.ts`; grep `matchmaking_rating_changes_pkey` /
  `reconcileIncompleteResults` — line numbers drift.)

- **Decisive-kill (`Stop-Process` one `StarCraft.exe`) often disputes when unattended** (seen
  2026-06-16). The survivor hangs on BW's dropped-player dialog with no human to dismiss it (~2 min,
  sometimes crash-looping `c000001d`) and never reports; the killed side reports `unknown` via the
  Electron fallback → game reconciles **disputed** (both `unknown`) → **no `matchmaking_rating_changes`,
  ratings unmoved**. **Resolved for runs with a human available:** a *graceful in-game leave* (F10 →
  Quit/Leave) instead of a process kill ends the game normally and yields a clean winner-up/loser-down
  MMR delta — validated for both 1v1 and 2v2 on PR #1286 (see T4 "Decisive finish" → human path).
  So this is only a hazard for fully-unattended runs; when you need the MMR delta, get a human to
  leave gracefully rather than killing the process. (The matcher-side writes — formation,
  `games`/`games_users`, `selected_matchup`, `matchmaking_completions` — happen regardless of finish.)
