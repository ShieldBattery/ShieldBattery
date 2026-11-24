---
name: verify-app
description: Launch and drive the real ShieldBattery Electron app with the sb-app script and playwright-cli over the Chrome DevTools Protocol. Use it to verify ANY client/feature behavior, single-client or multi-client (chat, whispers, lobbies, parties, matchmaking), and any time you need a dev app instance running - to start a game against computers, play a replay, take in-game screenshots or run a capture or benchmark. The browser + /dev pages only prove superficial rendering (they're not wired to the Redux store and use mock data).
---

# Verifying changes in the Electron app

The Electron app is the **primary** verification surface. Most features are gated behind the
Electron client check, and the web `/dev` devonly pages render against mock data with no store: they
prove a component _looks_ right, nothing more. To verify that something _works_, drive the real app.

[sb-app.mjs](./sb-app.mjs) does the repetitive parts (launch, wait until rendered, log in, attach
playwright-cli, make a lobby against computers, start a replay, wait for a game state, tear down).
You drive everything else with `playwright-cli` on the session it attached. Like `dev-stack.mjs` it
works from any directory and shell, and drives the checkout it lives in.

```bash
node .claude/skills/verify-app/sb-app.mjs launch 2                      # instance 2, logged in as claude-2
node .claude/skills/verify-app/sb-app.mjs lobby 2 --computers 1 --start # melee vs 1 computer, waits for 'playing'
node .claude/skills/verify-app/sb-app.mjs end 2                         # end the game, keep the app
node .claude/skills/verify-app/sb-app.mjs stop --all                    # tear down every instance sb-app launched
```

## Prerequisites

1. **Dev stack running** (the **dev-env** skill): `dev-stack.mjs start node rust renderer`. `launch`
   refuses without :5555 and :5566, because the dev app fetches its shell and modules from the
   renderer dev server.
2. **Seeded accounts**: `pnpm run seed-dev` (`claude-admin` + `claude-1..12`, password
   `shieldbattery`, UI language reset to English).
3. **`playwright-cli`** is a global npm tool on PATH: run it bare (`playwright-cli --version` →
   `0.1.14`). Don't wrap it in `npx`/`pnpm dlx`/`pnpm exec`; they add noise to stdout that corrupts
   the output you parse, and `pnpm dlx` re-downloads it.
4. **Game DLL, if you changed `game/` and will launch a game:** `node game/gates.mjs --build` (or
   `game\build.bat`, plus `build.bat x86` for 32-bit). A bare `cargo build` leaves
   `game/dist/shieldbattery_64.dll` stale, so the launched game silently runs the _old_ code.
   `launch` warns when the DLL in `dist` is older than the game sources. To inject a DLL from
   somewhere else (another worktree's `game/dist`, or a pinned copy while `dist` is being rebuilt),
   pass `--dll-dir <dir>` (sets `SB_GAME_DLL_DIR`, dev builds only).
5. **App main-process bundle, if you changed `app/` (or `common/` code it uses):**
   `pnpm run build-app-main`, then relaunch the instances. The app runs the _bundled_ main process
   from `app/dist/index.js`; only the renderer is served live. `launch` warns when the bundle is
   older than that code. A stale bundle is otherwise silent until something you added is missing at
   runtime (e.g. `No handler registered for '…'`).

## Launching

Instance N (1..12) is `SB_SESSION=sessionN` (its own settings and login), CDP port 9221+N,
playwright-cli session `cN`, default account `claude-N`.

```bash
node .claude/skills/verify-app/sb-app.mjs launch <N> [--foreground] [--hidden] [--env K=V]...
     [--dll-dir <dir>] [--login <user>] [--no-login]
```

`launch` warms the renderer, starts Electron, waits for the CDP port and for the app to actually
render (a window that stays blank is relaunched), handles login, attaches `playwright-cli -s=cN`, and
prints one line: PID, port, cli session, logged-in user. It takes roughly 10 s. If instance N is
already up it is reused as is, and launch flags are ignored with a warning: to change `--env`,
`--dll-dir` or window mode, `stop N` first.

**Which instance.** Use instance 2 and up for test accounts. **Instance 1 is usually logged in as the
developer's own dev account**, and `launch` keeps whoever is already logged in unless you pass
`--login <user>`. Don't log that account out or run throwaway tests on it uninvited. Always read the
`user` in launch's output rather than assuming `claude-N`.

**Login rules.** Logged out → logs in as `--login` or `claude-N`. Already logged in → keeps that
account unless `--login` names a different one, in which case it logs out and back in. Test instances
come back logged out after every relaunch, which is why `launch` logs in for you.
`sb-app.mjs login <N> <user>` switches accounts on a running instance.

**Window behavior. The user is usually working on this machine while you test.**

- By default `launch` sets `SB_APP_BACKGROUND=1` and `SB_GAME_BACKGROUND=1`: the app and any game it
  launches open behind other windows without taking focus or moving the cursor. Driving over CDP
  works the same, the game still renders, and `screenshot(gameId)` works. The game log confirms it:
  `Launching in the background (SB_GAME_BACKGROUND=1)`.
- `--hidden` never shows the app window at all. Use it for unattended runs that only need the game
  or the store. Don't use it when you need page screenshots (`playwright-cli screenshot`): a hidden
  window has been seen to stop producing frames, and the screenshot hangs waiting for fonts.
- `--foreground` is for when the user will look at or play in that instance. **Tell them what to
  look for before you launch**, because they can't read your messages once a game has focus.
- Exclusive **Fullscreen** takes over the display regardless; `sb-app` refuses to launch a game for
  a session whose StarCraft settings use it. Use windowed or windowed fullscreen.
- Background screenshots on the legacy DX9 renderer have come back black with a known-good DLL.
  Confirm a black capture with a `--foreground` launch before treating it as a rendering bug.

**Useful `--env` values** (dev builds): `SB_SCR_EXTRA_ARGS=--renderer=ogl|legacy` (pick SC:R's
renderer), `SB_HIDE_DEBUG_UI=1` (no Debug window in screenshots), `SB_ROLLBACK_HARNESS` (see the
**rollback-soak** skill).

**A new `SB_SESSION`** (no settings file yet) gets a "First launch" game-defaults dialog after
login; `launch` dismisses it. Instances 1..12 already have settings files, including the StarCraft
path. Don't invent session names with hand-written settings: copy an existing session's files if you
need a variant, since a bad settings file makes every game launch crash with a visible dialog.

<details>
<summary>What launch does, if you ever have to do it by hand</summary>

- Start `node_modules\electron\dist\electron.exe app --remote-debugging-port=<port>` **directly, by
  absolute path** (a relative path breaks as soon as the shell's working directory has moved). Every
  wrapper (npx, pnpm, a background shell task) breaks the Windows process tree, so stopping the
  wrapper leaves the real `electron.exe` running as an orphaned window. From PowerShell,
  `Start-Process -PassThru` returns the real PID.
- **Remove `ELECTRON_RUN_AS_NODE` from the environment.** VS Code runs its extension host with
  `ELECTRON_RUN_AS_NODE=1` and every tool process inherits it; left set, Electron runs as plain Node
  and dies with `TypeError: Not running in an Electron environment!`.
- Set `SB_HOT=1`, `SB_SESSION`, and the two background variables.
- Wait for the renderer before launching. A window that came up blank (`504 Outdated Optimize Dep`
  in the console, empty body) is fixed by restarting or warming the renderer
  (`dev-stack.mjs warm`) and **relaunching**; `playwright-cli reload` tends to drop the CDP session
  instead.
- `playwright-cli -s=cN attach --cdp=http://localhost:<port>` (not `open`/`goto`), and `detach`
  (not `close`) to leave the app running.
- Stop with `Stop-Process -Id <pid> -Force` / `taskkill //F //T //PID <pid>`, never by image name
  (other Electron apps are running), then confirm the CDP port is free.

</details>

## Driving the app with playwright-cli

```bash
playwright-cli -s=c2 snapshot
playwright-cli -s=c2 click "getByTestId('nav-play-button')"
playwright-cli --raw -s=c2 eval "document.querySelector('[data-testid=app-bar-user-button]')?.textContent"
```

- **Use `--raw` whenever you read a value.** It prints only the result. Without it the result is
  buried in status and code-echo lines whose layout varies by command, which is what breaks
  `sed -n 2p`-style parsing.
- **Prefer `data-testid` hooks** (`getByTestId('name')`; inside an `eval`,
  `document.querySelector('[data-testid=name]')`). They are stable and independent of the UI
  language. Text and role-name locators break when the account's language isn't English, which
  happens whenever someone has been checking translations. If you find a non-English UI on a seeded
  account, re-run `pnpm run seed-dev`.
- For elements without a test id, take a `snapshot` to get a ref (refs are ephemeral: re-snapshot per
  step). Snapshot files are written relative to the current directory, so run from one directory
  or use `--raw snapshot` and read stdout.
- Selector strings don't take Playwright's `>> nth=0` suffix. For "the second match" and other
  multi-step interactions use `run-code` with `.nth()` / `.first()`:
  `playwright-cli -s=c2 run-code "async page => { await page.getByTestId('lobby-slot').nth(1).hover() }"`.
- **Don't click via an `eval` that finds an element and calls `.click()`** for app buttons that open
  overlays: it does not reliably fire the React handler. Use a locator click.
- **Every click times out with "intercepts pointer events"?** Two known causes. The dev server's
  error overlay after a transient error:
  `playwright-cli -s=cN eval "(document.querySelector('vite-error-overlay')?.remove(), 'x')"`. Or a
  narrow window, where the social sidebar overlays the page: `playwright-cli -s=cN resize 1600 1000`.
  Don't send click output to `/dev/null`; the message that tells you this is in it.
- **Stale module after an edit.** Two quick writes to one file (an edit, then the formatter) can
  leave the renderer serving a half-updated module: a runtime error or style that contradicts the
  source on disk. Check with `curl -s http://localhost:5566/client/<path> | grep <new code>`; fix
  with `touch <file>`.
- **Benign console noise** (don't chase): a `410 (Gone)` on `/api/1/sessions` while logged out, an
  Electron insecure-CSP warning, and a Mantine `UNSAFE_componentWillReceiveProps` warning.
- **Never wait with a bare `sleep N` in front of another command**; the harness blocks it. Use
  `sb-app.mjs wait`, or a bounded loop that polls a condition with a short sleep per iteration. A
  foreground command that runs past about two minutes gets moved to the background, so start long
  runs with `run_in_background` and wait for the completion notice. Don't run long CDP polling loops
  as background shell loops: they have dropped the playwright-cli session mid-wait.

### Test ids

| test id | Element | Screen |
| --- | --- | --- |
| `app-bar-login` | "Log in" button (opens the login overlay; the URL stays `shieldbattery://app/`) | app bar, logged out |
| `app-bar-user-button` | Logged-in marker; text is name + rank, e.g. `claude-2Novice` | app bar |
| `app-bar-logout` | "Log out" item, in the overlay `app-bar-user-button` opens | app bar |
| `submit-button` | Login form submit (inputs are `input[name="username"]` / `input[name="password"]`) | login form |
| `discord-activity-decline` / `discord-activity-enable` | The post-login "share activity" prompt (`discord-activity-prompt`); only appears while Discord is running and the account hasn't answered | after login |
| `nav-play-button` | The big Play button (opens the last-used play tab) | home |
| `play-tab-lobbies` / `play-tab-matchmaking` | Play page tabs | `/play/*` |
| `create-lobby-button` | Opens the create-lobby form | `/play/lobbies` |
| `lobby-name-input` | Lobby-name field | create form |
| `create-lobby-submit` | Submits the create form | create form |
| `lobby-list-entry` | One row per joinable lobby (text = name + host) | `/play/lobbies` |
| `join-lobby-button` | Joins the selected lobby | lobby browser |
| `lobby-slot` | One per slot (open/closed/player). **No index**: use `.nth()` or contained text | lobby view |
| `lobby-slot-actions` | The host's per-slot menu button. Only clickable while its row is hovered or focused | lobby view |
| `lobby-slot-action-<id>` | Slot menu items: `add-computer`, `close-slot`, `open-slot`, `make-host`, `kick`, `ban`, `remove`, `make-observer`, `move-into-player-slot` | lobby view |
| `ready-up-button` / `cancel-ready-button` | A joiner's ready toggle | lobby view |
| `start-game-button` | Host's Start game | lobby view |
| `leave-lobby-button` | Leave lobby | lobby view |
| `accept-match-button` | "Ready up" in the match-found dialog | matchmaking |

Logging in by hand, when you need to (the script does exactly this):

```bash
playwright-cli -s=cN click "getByTestId('app-bar-login')"
playwright-cli -s=cN fill 'input[name="username"]' claude-N
playwright-cli -s=cN fill 'input[name="password"]' shieldbattery
playwright-cli -s=cN click "getByTestId('submit-button')"
```

Logging out from `/play` or a lobby route lands on the login form directly (and `app-bar-login` is
then disabled): just fill the form.

## A game against computers

```bash
node .claude/skills/verify-app/sb-app.mjs lobby <N> [--computers <k>] [--name <name>] [--map <mapId>] [--listed] [--start]
```

Creates a Melee lobby (unlisted unless `--listed`, on an official non-EUD map), adds `k` computers
(default 1), and with `--start` starts it and waits for `playing` (about 20 s). It refuses while the
instance is already in a game, and exits 3 with a plain message when the server answers
`409 AlreadyInActivity` (see "Ending games" below) instead of polling a game that will never start.

Adding a computer by hand in a lobby you host:

```bash
playwright-cli -s=c2 run-code "async page => {
  const row = page.getByTestId('lobby-slot').nth(1)
  await row.hover()
  await row.getByTestId('lobby-slot-actions').click()
  await page.getByTestId('lobby-slot-action-add-computer').click()
}"
```

- The menu button is invisible to pointer events until its row is hovered or focused, so hover the
  row first. Clicking an open slot's row itself **moves you into that slot**; it does not add a
  computer.
- "Add computer" is only offered on open or closed player slots of a lobby type that takes computers
  (Melee does; the create form remembers the last game type, so a remembered Top vs Bottom or UMS
  lobby may not offer it).
- UMS / EUD maps change end-of-game behavior (SC:R skips its own `LastReplay.rep` autosave on EUD
  maps), so use a plain melee map unless the test needs otherwise.

## Two-client flows

Launch two instances (`launch 2`, `launch 3`) and exercise the interaction from both sides: send a
whisper from `c2` and assert it in `c3`'s snapshot; invite to a party and accept; and so on.

Lobby with two humans (`c2` hosts, `c3` joins):

```bash
# c2 hosts
playwright-cli -s=c2 click "getByTestId('nav-play-button')"
playwright-cli -s=c2 click "getByTestId('play-tab-lobbies')"       # Play opens the last-used tab
playwright-cli -s=c2 click "getByTestId('create-lobby-button')"    # form remembers last map/type/name
playwright-cli -s=c2 fill  "getByTestId('lobby-name-input')" my-test-lobby
playwright-cli -s=c2 click "getByTestId('create-lobby-submit')"    # → /lobbies/<id>/my-test-lobby

# c3 joins: selecting a row only selects it; the join is a separate button
playwright-cli -s=c3 click "getByTestId('nav-play-button')"
playwright-cli -s=c3 click "getByTestId('play-tab-lobbies')"
playwright-cli -s=c3 run-code "async page => { await page.getByTestId('lobby-list-entry').filter({ hasText: 'my-test-lobby' }).click() }"
playwright-cli -s=c3 click "getByTestId('join-lobby-button')"

# Joiners ready up; the host counts as ready. Then the host starts.
playwright-cli -s=c3 click "getByTestId('ready-up-button')"
playwright-cli -s=c2 click "getByTestId('start-game-button')"
node .claude/skills/verify-app/sb-app.mjs wait 2 playing
```

- **Not everyone ready?** A plain click on `start-game-button` does nothing. The host can bypass
  readiness by pressing and holding the button for 2 s (`START_GAME_HOLD_MS` in
  `client/lobbies/room/use-start-game-hold.ts`):
  `playwright-cli -s=c2 run-code "async page => { const b = page.getByTestId('start-game-button'); await b.hover(); await page.mouse.down(); await page.waitForTimeout(2500); await page.mouse.up(); }"`
- **3+ players / a bigger map:** the map's slot count caps the lobby; open slots just aren't
  participants. Confirm who's in via
  `--raw eval "[...document.querySelectorAll('[data-testid=lobby-slot]')].map(e=>e.textContent)"`.
- **Lobbies are persistent.** A lobby survives its game: when the game ends, every client lands back
  in the same lobby, and the host can change map and settings from inside it. For repeated games,
  reuse the lobby (and don't leave a lobby the user set up for you).
- **Picking a map by hand:** click a tile in the create form's "Recent maps" strip or use "Change
  map", then confirm the summary line above the Create button names the map you wanted; a click that
  didn't take leaves the old map in place silently.
- **Matchmaking** is a separate path with its own accept and ban steps: see the **verify-pr**
  skill's T4 game-launch tier. The match-found dialog's button is `accept-match-button` (the page
  behind it has a lobby "Ready up" of its own, so a role/name locator is ambiguous).

## Replays

```bash
node .claude/skills/verify-app/sb-app.mjs replay <N> <file.rep> [--start-frame <f>]
```

Starts the replay and waits until it is playing (a few seconds). Replays show no loading screen, and
their state lives in `gameClient.watchOnly[<id>]`, **not** `gameClient.status` (which stays `null`),
so wait on them with `sb-app.mjs wait <N> playing --replay`. Passing a `.rep` as an Electron launch
argument does not work in dev builds; go through the app.

## Waiting for a game state

Launching a game is slow (StarCraft starts, the DLL injects, networking comes up):
`gameClient.status.state` walks `launching` → `configuring` → … → `playing` over 15–60 s, and later
`playing` → `hasResult` → `resultSent` → `finished`.

```bash
node .claude/skills/verify-app/sb-app.mjs wait <N> <state> [--replay] [--timeout <s>]
```

It prints each state change with elapsed time and fails fast, saying what it saw, on an error state,
a game that ended first, a dead StarCraft process or app, or timeout (default 180 s). A game that was
killed or force-quit ends as `unknown`, not `finished`.

## Driving the store directly

Dev builds expose the Redux store as `window.__sbReduxStore`, and any client module can be imported
from the renderer dev server, so you can dispatch an action creator instead of clicking through UI
that has no stable hook:

```bash
playwright-cli -s=c2 run-code "async page => page.evaluate(async () => {
  const m = await import('http://localhost:5566/client/navigation/routing.ts')
  m.push('/play/lobbies')
})"
```

- The URL must be absolute (`http://localhost:5566/client/...`); a bare `/client/...` resolves
  against `shieldbattery://app/` and fails.
- Pass file paths with **forward slashes** (`C:/dir/file.rep`); backslashes get eaten on the way
  through the shell and `eval`.
- A module the app loaded after an HMR update lives at a `?t=…` URL, and importing the bare URL
  evaluates a second copy. That is harmless for action creators (they go through the store) but not
  for modules with their own state.
- Useful ones: `client/navigation/routing.ts` (`push`), `client/replays/action-creators.ts`
  (`startReplay({ path, startFrame })`), `client/lobbies/action-creators.ts` (`createLobby`,
  `addComputer`), `client/settings/action-creators.ts` (`mergeScrSettings`, to change SC:R settings
  on a running instance).

## Reading what happened

- **Redux state**:
  `playwright-cli --raw -s=c2 eval "JSON.stringify(window.__sbReduxStore.getState().gameClient)"`.
  `gameClient.status` is the full `ReportedGameStatus` (state, error, `networkStatus`, …): assert on
  this instead of grepping the game log.
- **UI state**: `snapshot`, and `console` for renderer errors (a failed request such as a `409`
  shows up here). **Network**: `requests`.
- **App and game logs**: `%APPDATA%\ShieldBattery-Local\logs\app-<session>.0.log` and
  `game-<session>.0.log` (see the dev-env skill).
- **Server-side truth**: query Postgres directly when the UI isn't enough (dev-env has the `psql`
  one-liner). This is first-class; don't rely on UI alone for data correctness.
- **Visibility-dependent behavior can't be observed while attached.** An attached CDP client pins
  `document.visibilityState` to `visible`, even when the window is really minimized. To test
  minimize/occlusion behavior: arm an in-page script that records to `localStorage`, `detach`, have
  the state change happen, then re-attach and read the result.

### The debug-game control surface

Dev builds with a debug DLL expose `window.__sbDebugGame` (a release DLL doesn't implement it, so
calls time out with "it may not be a debug build"): `queryGameState(gameId)`,
`screenshot(gameId)`, `sendChat(gameId, text)`, `requestDrop(gameId, slot)`,
`toggleNetStats(gameId)`, `forceQuit(gameId)`, `forceUnsyncedLeave(gameId, slot)`,
`forceDesync(gameId)`, `crash(gameId, kind)`, and
`setRollback(gameId, depth, { [stormPlayer]: frames })` (only in a replay launched with
`SB_ROLLBACK_HARNESS`; depth 0 turns rolling back off). The game id is
`window.__sbReduxStore.getState().gameClient.gameId`.

**Input injection:** `input(gameId, events)` posts `{type:'key',vkey,down}`, `{type:'char',code}`,
`{type:'mouseMove',x,y}`, `{type:'mouseButton',x,y,button:'left'|'right',down}` and
`{type:'wait',ms}` to the game window, with `pressKey(gameId, vkey)` and
`click(gameId, x, y, button = 'left')` as helpers. Coordinates are game-window client pixels, as in
the `screenshot`. Limits that are easy to mistake for a broken build:

- Posted **clicks and drags reach our overlay UI, not SC:R's own input** (unit selection, the
  minimap, native buttons such as alliances) while the game is in the background. A click that
  selects nothing proves nothing. Use overlay elements and log lines, or a `--foreground` launch
  with the user at the mouse.
- Posted **keys do work** (F10 opens the menu; menu hotkeys follow).
- Posted modifiers don't change the game's key state, so shifted combos can't be driven, and hover
  tooltips don't render from a posted mouse move.

**`crash(gameId, 'accessViolation' | 'stackOverflow')`** kills the game with that fault to exercise
the crash handler: expect `[CRASH]` lines in the game log, a fresh non-empty `latest_crash.dmp` in
the logs dir, a "Shieldbattery crash :(" message box (close it, or kill that `StarCraft.exe`), and a
crash-code exit + "Crash dump written" line in the app log.

### Ending games

```bash
node .claude/skills/verify-app/sb-app.mjs end <N>     # forceQuit the game and any replays, keep the app
```

The ways to end a game differ in ways that matter; pick deliberately:

- **`forceQuit(gameId)`** (what `end` and `stop` use) is a hard process-level end that works
  mid-game and at the native victory dialog, and lets the app reset its own state. Opponents see a
  drop. Prefer it over killing `StarCraft.exe`. After it, clicking `start-game-button` again in the
  same lobby is a fast repeat loop.
- **`forceDesync(gameId)` is THE desync trigger.** It perturbs the calling client's own sim state,
  so both clients keep playing while their checksums diverge: the relay comparator fires within
  seconds, a 1v1 **voids** (no-majority), team games discard the caller as the diverged minority.
  Use it to exercise desync policy and desync-flagged paths.
- **`forceUnsyncedLeave(gameId, slot)`** injects a local, non-consensus leave. `slot` is required;
  the caller's own slot is `turnState.localSlot` in `queryGameState`. With other humans in the game
  it usually ends it as a voided desync (no win/loss, no MMR). Against only computers it does not
  end the game at all.
- **A real, scored finish** needs a graceful leave through the in-game menu. With humans that means
  a person at the keyboard (verify-pr T4). Against computers, posting the menu keys has worked
  unattended: `pressKey` F10, then `E`, then `Q`, reached `finished`.

**`409 AlreadyInActivity` on the next lobby or queue** means the server still has that account in
its previous game. It has shown up after hard-killing games whose results never reconciled, which is
what happens to multi-human games against a remote coordinator when the webhook funnel isn't running
(see dev-env). Restart the Node server (`dev-stack.mjs restart node`) to clear it, or carry on with a
different instance number. Don't wait it out and don't poll a lobby that failed to create.

## Subagents

A subagent sees only its prompt. When you delegate app verification, tell it to load **dev-env** and
**verify-app**, which instance numbers to use, and whether the servers already running are the
user's and must be left alone. Don't brief a subagent to check a _behavior_ change on a `/dev` page.

## Cleanup

When the task is done, shut down everything you started, unless you'll reuse it in the same session
(and if you leave something up, say so in your reply):

```bash
node .claude/skills/verify-app/sb-app.mjs stop --all    # games ended, app trees killed, cli sessions detached, ports checked
node .claude/skills/verify-app/sb-app.mjs status        # nothing left on 9222-9233
node .claude/skills/dev-env/dev-stack.mjs stop          # servers you started through dev-stack
```

`stop` only touches instances `sb-app` launched, and only kills `StarCraft.exe` processes those
instances spawned. An app on a CDP port that `sb-app` didn't launch is listed by `status` as such;
if it is a leftover from an earlier agent, kill it by the PID that owns the port
(`taskkill //F //T //PID <pid>`), never by image name. Leave Docker running.

## When the browser is enough

Only for pure CSS/layout/visual checks on a component that has a `/dev` page, and for pages that
work in the web client. Start `node` + `rust`, then
`playwright-cli open http://localhost:5555/dev` and `resize 1600 1000` (at the default width the
social sidebar's scrim swallows clicks). Never use this to claim a _behavior_ works.
