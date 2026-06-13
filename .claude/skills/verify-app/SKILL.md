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
3. `playwright-cli` available. On this machine the global isn't on PATH — use
   `npx --no-install playwright-cli ...` (verify with `npx --no-install playwright-cli --version`).
   The examples below write `playwright-cli` for brevity; prefix with `npx --no-install` when running.
   Running them through the Bash tool (and appending `2>/dev/null`) avoids npm's config-warning noise.

## Launch the app with a debugging port

Electron exposes a CDP endpoint when launched with `--remote-debugging-port`. Run it as a
**background** process. Use a distinct `SB_SESSION` (separate settings + session storage, so a
second instance can be logged in as a different account) and a distinct port per instance:

```bash
# Instance 1 (background)
SB_HOT=1 SB_SESSION=session1 npx electron app --remote-debugging-port=9222

# Instance 2 — only for multi-client flows (background)
SB_HOT=1 SB_SESSION=session2 npx electron app --remote-debugging-port=9223
```

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
to `/login`). Then fill the form (standard `name` inputs + `data-test` submit) and check the
logged-in marker:

```bash
# Open the form (snapshot first to get the ref, or use the role locator):
playwright-cli -s=c1 click "getByRole('button', { name: 'Log in' })"
playwright-cli -s=c1 fill 'input[name="username"]' claude-1
playwright-cli -s=c1 fill 'input[name="password"]' shieldbattery
playwright-cli -s=c1 click 'button[data-test="submit-button"]'
# Logged-in marker (also carries the name+rank, e.g. "claude-1Novice"):
playwright-cli -s=c1 eval "document.querySelector('[data-test=app-bar-user-button]')?.textContent"
```

Seeded accounts are email-verified, so the verification dialog won't block you. Finding elements:
prefer `data-test` selectors (`getByTestId(...)` or `[data-test=...]`); take a `snapshot` first to
get refs.

**Benign console noise** (don't chase these): a `410 (Gone)` on `/api/1/sessions` while logged out
(it's the "do I have a session?" probe), an Electron insecure-CSP warning, and a Mantine
`UNSAFE_componentWillReceiveProps` warning — all expected in dev.

## Two-client flows

Log instance 1 in as `claude-1` and instance 2 as `claude-2`, then exercise the interaction from
both sides.

> **Log each instance in deliberately, one step at a time** — click "Log in", *wait for the form
> overlay to actually render* (`eval "!!document.querySelector('input[name=username]')"` → `true`)
> before filling, then submit. A fast fire-and-forget helper that logs both instances in back-to-back
> races the second renderer and can pop a transient `Error / Gone` (410) dialog. If that happens,
> close the dialog (click its exact `× Close` ref from a snapshot — the role locator `Close` is
> ambiguous with the window control) and redo the login.

Examples:

- **Whisper / chat**: send from `c1`, assert the message appears in `c2`'s snapshot.
- **Lobby**: `c1` creates/hosts, `c2` joins; verify both see the slot changes.
- **Party**: `c1` invites `claude-2`; accept on `c2`; verify party state on both.
- **Matchmaking**: queue both clients on the same type/maps; verify a match is found and the
  countdown/launch begins on both. (Actually *launching the game* and verifying outcomes is the
  **verify-pr** skill's game-launch tier.)

## Reading what happened

- **UI state**: `playwright-cli -s=cN snapshot` and `... console` (renderer console / errors).
- **App logs**: `%APPDATA%\ShieldBattery-Local\logs\app.0.log` — shared across instances, so grep by
  the message you expect rather than assuming ordering.
- **Network**: `playwright-cli -s=cN requests` to confirm an API call fired and its status.
- **Server-side truth**: query Postgres directly (`DATABASE_URL` in `.env`) when the UI isn't
  enough — e.g. confirm a row was written. This is first-class; don't rely on UI alone for data
  correctness.

## Cleanup

`detach` each playwright-cli session, then stop the Electron background processes you started. Leave
Docker running.

## When the browser is enough

Only for pure CSS/layout/visual checks on a component that has a `/dev` page. Start the Node server,
`playwright-cli open http://localhost:5555/dev`, navigate to the component. Never use this to claim a
*behavior* works.
