---
name: verify-app
description: Drive the real ShieldBattery Electron app to verify functionality — single-client or multiple clients at once (chat, whispers, lobbies, parties, matchmaking). Connects to the running app over the Chrome DevTools Protocol with playwright-cli. Use this for ANY client/feature behavior verification; the browser + /dev pages only prove superficial rendering (they're not wired to the Redux store and use mock data).
---

# Verifying changes in the Electron app

The Electron app is the **primary** verification surface. Most features are gated behind the
Electron client check, and the web `/dev` devonly pages render against mock data with no store — they
prove a component *looks* right, nothing more. To verify that something *works*, drive the real app.

## Prerequisites

1. Dev stack running (see the **dev-env** skill): Postgres/Redis, Node server (:5555), Rust server
   (:5556), and the **webpack dev server (:5566)** — the dev app loads its renderer from there.
2. Seeded accounts: `pnpm run seed-dev` (gives `claude-admin` + `claude-1..3`, password
   `shieldbattery`).
3. `playwright-cli` available. It's a **global** npm tool (not a project dependency) and is on PATH,
   so just run it directly — `playwright-cli --version` (→ `0.1.14`), `playwright-cli -s=c1 snapshot`,
   etc. No wrapper needed; it prints clean output with no npm config noise.
   - **Don't wrap it in `npx`/`pnpm dlx`/`pnpm exec`.** `npx` (even `--no-install`) adds config-warning
     noise you'd have to `2>/dev/null` away. `pnpm dlx` re-downloads from the registry each run (the
     fetch-and-run path — it would drift from the pinned global). `pnpm exec` prints `Already up to
     date` / `Done in Nms` to **stdout** (not stderr — `2>/dev/null` won't strip it), corrupting the
     snapshot/eval output this skill parses. And `playwright-cli` isn't a project dep, so pnpm has
     nothing to resolve for it anyway. Bare `playwright-cli` is the clean choice.
4. **If you changed `game/` Rust code and will launch a game to verify it, rebuild with
   `game\build.bat` first** — a bare `cargo build` leaves `game/dist/shieldbattery.dll` (the DLL the
   app injects) stale, so the launched game silently runs the *old* code. If a game-launch result
   contradicts your change, suspect a stale `dist/` DLL. (See AGENTS.md → Game DLL.)

## Launch the app with a debugging port

Electron exposes a CDP endpoint when launched with `--remote-debugging-port`. Use a distinct
`SB_SESSION` (separate settings + session storage, so a second instance can be logged in as a
different account) and a distinct port per instance.

**Launch with PowerShell `Start-Process -PassThru` and record the PID** — do NOT launch via
`npx electron` (or bash + the electron binary) as a background task. Every wrapper layer (npx,
pnpm, Git Bash's `env`/MSYS exec emulation) breaks the Windows process tree, so `TaskStop` kills
only the wrapper and the real `electron.exe` survives as an orphaned, visible window (verified:
even a direct-binary bash launch orphans). `Start-Process` returns the *actual* electron PID, and
`Stop-Process` on it takes down the whole app, Chromium children included:

```powershell
# Instance 1 (PowerShell tool — returns immediately, app runs detached; SAVE the PID)
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
$env:SB_HOT='1'; $env:SB_SESSION='session1'
$p = Start-Process -FilePath 'node_modules\electron\dist\electron.exe' `
  -ArgumentList 'app','--remote-debugging-port=9222' -PassThru; "PID: $($p.Id)"

# Instance 2 — only for multi-client flows: SB_SESSION='session2', port 9223, save its PID too
```

Sanity check the PID took the port: `netstat -ano | findstr :9222` → the LISTENING line's PID
must match what `Start-Process` returned.

> **Stripping `ELECTRON_RUN_AS_NODE` is mandatory when launching from an agent tool** (the
> `Remove-Item Env:` above; in bash it's `env -u ELECTRON_RUN_AS_NODE`). VS Code runs its
> extension host (which the Claude Code extension and its Bash/PowerShell tools live under) by
> spawning the Electron binary with `ELECTRON_RUN_AS_NODE=1`, and that var is inherited by everything
> the tools launch. Left set, the freshly-spawned `electron.exe` runs as plain Node and dies with
> `TypeError: Not running in an Electron environment!`. A human launching from a normal terminal
> never sees it (their shell doesn't have the var), so it's easy to miss — always strip it here.

`session1`/`session2`/`session3` already have their settings files configured (incl. the StarCraft
path) under `%APPDATA%\ShieldBattery-Local`.

> If `SB_HOT=1` shows a blank window, the webpack dev server (:5566) isn't ready yet — wait for it to
> finish compiling, then reload (`playwright-cli reload`).

## Connect playwright-cli over CDP

Attach one named playwright-cli session per app instance (don't use `open`/`goto` — the app is
already loaded):

```bash
playwright-cli -s=c1 attach --cdp=http://localhost:9222
playwright-cli -s=c2 attach --cdp=http://localhost:9223
```

Then drive each instance independently with its `-s` flag:

```bash
playwright-cli -s=c1 snapshot
playwright-cli -s=c1 click e15
playwright-cli -s=c2 snapshot
```

`detach` (not `close`) leaves the app running when you're done:
`playwright-cli -s=c1 detach`.

## Log in

The app boots to the **home screen, logged out**. Click the **"Log in"** button in the top app bar
to open the login form (it's an overlay — the URL stays `shieldbattery://app/`, it does not navigate
to `/login`). Then fill the form (standard `name` inputs + `submit-button` test id) and check the
logged-in marker:

```bash
# Open the form (snapshot first to get the ref, or use the role locator):
playwright-cli -s=c1 click "getByRole('button', { name: 'Log in' })"
playwright-cli -s=c1 fill 'input[name="username"]' claude-1
playwright-cli -s=c1 fill 'input[name="password"]' shieldbattery
playwright-cli -s=c1 click "getByTestId('submit-button')"
# Logged-in marker (also carries the name+rank, e.g. "claude-1Novice"):
playwright-cli -s=c1 eval "document.querySelector('[data-testid=app-bar-user-button]')?.textContent"
```

Seeded accounts are email-verified, so the verification dialog won't block you. Finding elements:
the app tags hooks with `data-testid` (Playwright's default test-id attribute), so
`getByTestId('name')` resolves them directly in both playwright-cli and the `integration/` suite —
prefer it. A `[data-testid='name']` CSS attribute selector works too, and is what you need inside an
`eval` (e.g. `document.querySelector('[data-testid=…]')`). For elements without a test id, take a
`snapshot` first to get a ref (refs are ephemeral — they regenerate each snapshot, so re-snapshot per
step), or use a role/name locator when the text is stable (`getByRole('button', { name: '…' })`).

**Benign console noise** (don't chase these): a `410 (Gone)` on `/api/1/sessions` while logged out
(it's the "do I have a session?" probe), an Electron insecure-CSP warning, and a Mantine
`UNSAFE_componentWillReceiveProps` warning — all expected in dev.

## Two-client flows

Log instance 1 in as `claude-1` and instance 2 as `claude-2`, then exercise the interaction from
both sides.

> **Login recipe — the plain role-locator sequence is reliable on every instance.** Per instance,
> one at a time (don't fire-and-forget-race them):
> ```bash
> playwright-cli -s=cN click "getByRole('button', { name: 'Log in' })"   # opens the form overlay
> sleep 2                                                                 # let the overlay render
> playwright-cli -s=cN fill 'input[name="username"]' claude-N
> playwright-cli -s=cN fill 'input[name="password"]' shieldbattery
> playwright-cli -s=cN click "getByTestId('submit-button')"
> ```
> Then confirm: `eval "document.querySelector('[data-testid=app-bar-user-button]')?.textContent"` →
> e.g. `"claude-1Novice"`. No native-value-setter fallback is needed on later instances.
> **Do NOT click "Log in" via an `eval` that finds the button by text and calls `.click()`** — that
> silently does *not* fire the React handler (the form never opens, `input[name=username]` stays
> absent). Use the `getByRole` locator (or a `snapshot` ref click) instead. If a rare transient
> `Error / Gone` (410) dialog pops, close it via its exact `× Close` ref from a snapshot (the role
> locator `Close` is ambiguous with the window control) and redo the login.

Examples:

- **Whisper / chat**: send from `c1`, assert the message appears in `c2`'s snapshot.
- **Lobby**: `c1` creates/hosts, `c2` joins; verify both see the slot changes.
- **Party**: `c1` invites `claude-2`; accept on `c2`; verify party state on both.
- **Matchmaking**: queue both clients on the same type/maps; verify a match is found and the
  countdown/launch begins on both. (Actually *launching the game* and verifying outcomes is the
  **verify-pr** skill's game-launch tier.)

## Navigating to an in-game state from a lobby (stable selectors)

This is the **lobby** path to getting two clients in-game — `c1` hosts a custom lobby, `c2` joins,
`c1` starts. (Matchmaking is a *separate* path with its own ready-up/ban mechanics — not covered
here; see the **verify-pr** skill's T4 game-launch tier for that.) The lobby → in-game path carries
`data-testid` hooks so you don't have to snapshot-scrape ephemeral refs at each step. Target them
with `getByTestId('…')` (or a `[data-testid='…']` selector inside an `eval`):

| test id | Element | Screen |
| --- | --- | --- |
| `nav-play-button` | The big Play button | home |
| `create-lobby-button` | Opens the create-lobby form | `/play/lobbies` |
| `lobby-name-input` | Lobby-name field (lands on the real `<input>`) | create form |
| `create-lobby-submit` | Submits the create form | create form |
| `lobby-list-entry` | One row per joinable lobby (text = name + host) | `/play/lobbies` |
| `start-game-button` | Host's Start game | lobby view |
| `leave-lobby-button` | Leave lobby | lobby view |
| `lobby-slot` | One per slot (open/closed/player). **No index** — disambiguate by contained text | lobby view |

Both accounts logged in (see Two-client flows). Host on `c1`, join on `c2`, start on `c1`:

```bash
# c1 hosts
playwright-cli -s=c1 click "getByTestId('nav-play-button')"       # → /play/lobbies
playwright-cli -s=c1 click "getByTestId('create-lobby-button')"   # → create form (remembers last map/name)
playwright-cli -s=c1 fill  "getByTestId('lobby-name-input')" my-test-lobby
playwright-cli -s=c1 click "getByTestId('create-lobby-submit')"   # → /lobbies/my-test-lobby (host in lobby)

# c2 joins by matching the row text, then clicking that specific entry
playwright-cli -s=c2 click "getByTestId('nav-play-button')"
# `nav-play-button` opens the LAST-USED play tab, which per account may be Matchmaking, not Lobbies —
# so click the "Lobbies (N)" tab first, then the entry. (Harmless if already on Lobbies.)
playwright-cli -s=c2 eval "[...document.querySelectorAll('button')].find(e=>/^Lobbies/.test(e.textContent||''))?.click(), 'x'"
playwright-cli -s=c2 eval "[...document.querySelectorAll('[data-testid=lobby-list-entry]')].find(e=>e.textContent.includes('my-test-lobby'))?.click(), 'joined'"

# c1 starts once c2 is in a slot
playwright-cli -s=c1 click "getByTestId('start-game-button')"
```

> **3+ players / a bigger map:** the map's slot count caps the lobby (an 8-slot map gives 8
> `lobby-slot`s); open slots just aren't participants, so a 3-human melee on a big map starts fine.
> Confirm who's in via `eval "[...document.querySelectorAll('[data-testid=lobby-slot]')].map(e=>e.textContent).filter(t=>/claude/.test(t))"`.

Then poll for the game to reach `playing` (next section). A launched game needs a **fresh debug DLL
in `game/dist`** (`game\build.bat`) — a stale one crashes at start (see verify-pr T4).

## Waiting for the game to reach a state (poll in the foreground)

Launching a game is slow — StarCraft starts, the DLL injects, and game networking is established —
so `gameClient.status.state` walks `configuring` → `playing` over ~30–60s, and the result
path later moves `playing` → `resultSent`/`finished`. Don't guess a fixed sleep; poll the state.

**Poll with a bounded *foreground* loop, one short `eval` at a time** — do **not** wrap a long
`until playwright-cli … eval …; do sleep; done` in a background Bash task. A long-lived background
loop of CDP evals silently drops the playwright-cli session mid-wait (later calls start failing
`The browser 'cN' is not open`) even though the Electron app itself stays up and listening — you
then have to `attach` again and you've lost the wait. A short foreground loop with a per-iteration
`sleep` is reliable:

```bash
# The eval result is on the SECOND output line, so sed -n 2p extracts it.
for i in $(seq 1 40); do
  st=$(playwright-cli -s=c1 eval "window.__sbReduxStore.getState().gameClient.status?.state ?? 'null'" 2>/dev/null | sed -n 2p)
  echo "[$i] $st"
  [ "$st" = '"playing"' ] && break
  sleep 4
done
```

Poll both instances in the same loop for a two-client game. If the session does drop, re-`attach`
(the app is still up on its CDP port) and resume — you do not need to relaunch the app.

## Reading what happened

- **Redux state (dev builds)**: the store is exposed as `window.__sbReduxStore` (dev bundles
  only), so app state is one eval away — e.g.
  `playwright-cli -s=c1 eval "JSON.stringify(window.__sbReduxStore.getState().gameClient)"`.
  Game-relevant: `gameClient.status` is the full `ReportedGameStatus` (state, error,
  `networkStatus`, …) — assert on this instead of grepping the game DLL log.
- **Debug-game control surface (dev builds + debug DLL)**: `window.__sbDebugGame` exposes
  `queryGameState(gameId)`, `forceLeave(gameId, slot)`, `forceQuit(gameId)`, and
  `screenshot(gameId)` for driving/inspecting a running game over CDP (a release DLL doesn't
  implement these, so query calls time out). `forceQuit` is the reliable way to tear a launched
  game down between checks — it works even mid-game, when the process would otherwise sit at the
  native victory dialog.
- **UI state**: `playwright-cli -s=cN snapshot` and `... console` (renderer console / errors).
- **App logs**: `%APPDATA%\ShieldBattery-Local\logs\app.0.log` — shared across instances, so grep by
  the message you expect rather than assuming ordering.
- **Network**: `playwright-cli -s=cN requests` to confirm an API call fired and its status.
- **Server-side truth**: query Postgres directly (`DATABASE_URL` in `.env`) when the UI isn't
  enough — e.g. confirm a row was written. This is first-class; don't rely on UI alone for data
  correctness.

## Cleanup

When the task is done, `detach` each playwright-cli session, then **shut down everything you
started** — the Electron instances, any game process still running, and any servers/side processes
you spun up for this verification (see the dev-env skill's Stopping section — including the caveat
that `TaskStop` on a `pnpm` task can orphan the child, so confirm ports are actually free). Only
leave something running if you'll reuse it in the same session. Leave Docker running.

**Closing the Electron instances: `Stop-Process` the PIDs you saved at launch, then verify.**
This is why the launch section captures the PID via `Start-Process -PassThru` — killing that PID
reliably takes down the whole app (Chromium children included). `TaskStop` on a wrapper task
(npx/pnpm/bash) does NOT work: it kills the wrapper and orphans the real `electron.exe` with its
window still open (verified the hard way — the user had to close them manually).

```powershell
Stop-Process -Id <pid1>,<pid2> -Force
```

Always verify, whichever path you took — the CDP ports are the ground truth (and the recovery
route if you lost a PID: the LISTENING line's last column is the PID to `taskkill //F //PID`):

```bash
netstat -ano | grep -E ':(9222|9223)\s' | grep LISTENING   # empty = actually gone
```

Don't `taskkill //IM electron.exe` — it's imprecise (other Electron-based dev tools may be
running); the saved PID / CDP port identifies exactly the instance you launched. A game process
the app spawned (`StarCraft.exe`) dies separately: `taskkill //F //IM StarCraft.exe`.

## When the browser is enough

Only for pure CSS/layout/visual checks on a component that has a `/dev` page. Start the Node server,
`playwright-cli open http://localhost:5555/dev`, navigate to the component. Never use this to claim a
*behavior* works.
