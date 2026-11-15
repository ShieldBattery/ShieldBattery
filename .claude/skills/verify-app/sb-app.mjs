#!/usr/bin/env node
// Launches and drives dev Electron app instances over CDP: launch + log in, create a Melee lobby
// with computers, start replays, wait for game states, and stop instances with their games. The
// pids of launched apps are kept in STATE_DIR so a later session can stop them.
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import {
  descendants,
  fmtDuration,
  killTree,
  listeners,
  loadEnv,
  pidAlive,
  portOwner,
  processTable,
  readJson,
  ROOT,
  sameProcess,
  sleep,
  staleReasons,
  STATE_DIR,
  waitForPortFree,
  warmRenderer,
  writeJson,
} from '../dev-env/stack-common.mjs'

const HELP = `usage: node .claude/skills/verify-app/sb-app.mjs <command> [args]

Instance N (1..12): SB_SESSION=sessionN, CDP port 9221+N, playwright-cli session cN, default
account claude-N (password shieldbattery).

commands:
  launch <N> [--foreground] [--hidden] [--env K=V]... [--dll-dir <dir>]
             [--login <user>] [--password <pw>] [--no-login]
      Starts the app (or reuses instance N if it is already up), waits until it renders, logs in,
      and attaches playwright-cli session cN. Logged out: logs in as --login or claude-N. Logged
      in: keeps that account unless --login names another one. Background flags
      (SB_APP_BACKGROUND, SB_GAME_BACKGROUND) are set unless --foreground.
  login <N> <user> [--password <pw>]
      Logs instance N in as <user>, logging out whoever else is logged in.
  lobby <N> [--name <name>] [--computers <k>] [--map <mapId>] [--listed] [--start]
            [--timeout <s>]
      Creates a Melee lobby (default 1 computer, unlisted; map: an official map the account used
      recently, else the first official map that fits, else any recent map), opens it, adds
      computers, and with --start starts it and waits for 'playing' (default 240s). Refuses while
      the instance is in a game. Exit 3 when the server says the account is already in an
      activity (HTTP 409).
  replay <N> <file.rep> [--start-frame <f>] [--timeout <s>]
      Starts a replay and waits until it is playing (default 180s).
  wait <N> <state> [--replay] [--timeout <s>]
      Polls gameClient.status (or watchOnly with --replay) until <state> (launching, configuring,
      awaitingPlayers, starting, playing, hasResult, resultSent, finished); a later active state
      also counts. Fails fast on an error state, a game that ends first (finished, or 'unknown'
      after a quit/kill), a dead game process or app, or timeout (default 180s). A game that had
      already ended when the wait began counts as no game, except for 'finished'.
  end <N> [--leave]
      Ends instance N's running game and replays with __sbDebugGame.forceQuit, then kills any
      StarCraft left under the app. --leave first tries forceUnsyncedLeave of its own slot and waits
      up to 30s for the game to end that way (only does anything with other humans in the game).
  stop <N...> | --all
      Ends running games (bounded), kills the app's process tree, checks the CDP port is free, and
      detaches cN. --all: every instance sb-app launched.
  status
      Instances sb-app launched, apps on ports 9222-9233 it didn't launch, their users and games.

exit codes: 0 ok; 1 failure or timeout; 2 bad usage or prerequisites missing; 3 account already in
an activity (lobby create 409)
state: ${STATE_DIR}\\sb-app.json`

const STATE_FILE = path.join(STATE_DIR, 'sb-app.json')
const APPDATA_DIR = path.join(process.env.APPDATA ?? '', 'ShieldBattery-Local')
const LOGS_DIR = path.join(APPDATA_DIR, 'logs')
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
const RENDERER = 'http://localhost:5566'
const ENV = loadEnv().vars
const SERVER_PORT = Number(ENV.SB_HTTP_PORT || 5555)
const DEFAULT_PASSWORD = 'shieldbattery'

const ORDER = [
  'launching',
  'configuring',
  'awaitingPlayers',
  'starting',
  'playing',
  'hasResult',
  'resultSent',
  'finished',
]
const ACTIVE = new Set(ORDER.slice(0, 7))

const log = (...a) => console.log(...a)

class UsageError extends Error {}
class ExitError extends Error {
  constructor(message, code = 1) {
    super(message)
    this.code = code
  }
}

const inst = n => ({
  n,
  session: `session${n}`,
  port: 9221 + n,
  cli: `c${n}`,
  account: `claude-${n}`,
})
const loadState = () => readJson(STATE_FILE, { instances: {} })
const saveState = s => writeJson(STATE_FILE, s)

function updateRecord(n, patch) {
  const s = loadState()
  if (patch === null) delete s.instances[n]
  else s.instances[n] = { ...s.instances[n], ...patch }
  saveState(s)
}

let chromiumPromise
function chromium() {
  chromiumPromise ??= import('@playwright/test').then(m => m.chromium)
  return chromiumPromise
}

// ---- Instances ----

/** Instance N's record if its app is still the process sb-app launched. */
function liveRecord(n, table = processTable()) {
  const rec = loadState().instances[n]
  if (!rec) return null
  return sameProcess(table, rec.pid, rec.start) ? rec : null
}

function requireInstance(n) {
  const rec = liveRecord(n)
  if (!rec) {
    // An app on the port that sb-app didn't launch (started by hand) is still drivable.
    const I = inst(n)
    const owner = portOwner(I.port)
    if (owner) return { pid: owner, port: I.port, session: I.session, external: true }
    throw new ExitError(`instance ${n} is not running (launch it with: sb-app launch ${n})`)
  }
  return rec
}

function appLogTail(session, lines = 20) {
  try {
    const text = fs.readFileSync(path.join(LOGS_DIR, `app-${session}.0.log`), 'utf8')
    return text.split(/\r?\n/).slice(-lines).join('\n')
  } catch (e) {
    return `(no app log: ${e.message})`
  }
}

function gameExePids(table, appPid) {
  return descendants(table, appPid)
    .filter(p => /^starcraft/i.test(p.name ?? ''))
    .map(p => ({ pid: p.pid, start: p.start }))
}

// ---- CDP ----

function pickPage(browser) {
  const pages = browser
    .contexts()
    .flatMap(c => c.pages())
    .filter(p => !p.url().startsWith('devtools://'))
  return pages.find(p => /^(shieldbattery:|http:\/\/localhost:5566)/.test(p.url())) ?? pages[0]
}

async function withPage(port, fn) {
  const browser = await (
    await chromium()
  ).connectOverCDP(`http://127.0.0.1:${port}`, {
    timeout: 20000,
  })
  try {
    let page = pickPage(browser)
    for (let i = 0; !page && i < 20; i++) {
      await sleep(500)
      page = pickPage(browser)
    }
    if (!page) throw new Error('the app has no page')
    return await fn(page)
  } finally {
    // Disconnects only; the app keeps running.
    await browser.close().catch(() => {})
  }
}

const RENDERED = () =>
  !!window.__sbReduxStore &&
  !!document.querySelector('[data-testid=app-bar-login],[data-testid=app-bar-user-button]')

async function currentUser(page) {
  return page.evaluate(() => {
    const self = window.__sbReduxStore?.getState().auth.self
    return self ? { name: self.user.name, loginName: self.user.loginName } : null
  })
}

const sameUser = (cur, want) =>
  !!cur && [cur.name, cur.loginName].some(x => x?.toLowerCase() === want.toLowerCase())

/** Removes Vite's error overlay, which swallows every pointer event while it is up. */
async function clearOverlays(page) {
  await page.evaluate(() => document.querySelector('vite-error-overlay')?.remove()).catch(() => {})
}

async function click(page, locator, timeout = 10000) {
  try {
    await locator.click({ timeout })
  } catch (e) {
    await clearOverlays(page)
    await page.keyboard.press('Escape').catch(() => {})
    await locator.click({ timeout }).catch(() => {
      throw e
    })
  }
}

// ---- Launch ----

function requireServers() {
  const ls = listeners()
  const missing = []
  if (!ls.has(5566)) missing.push('renderer dev server (:5566)')
  if (!ls.has(SERVER_PORT)) missing.push(`Node server (:${SERVER_PORT})`)
  if (missing.length) {
    throw new ExitError(
      `not running: ${missing.join(', ')}. Start them with:\n` +
        `  node .claude/skills/dev-env/dev-stack.mjs start node rust renderer`,
      2,
    )
  }
  if (!ls.has(Number(ENV.SB_GQL_PORT || 5556))) {
    log('WARNING: the Rust server (:5556) is not running; GraphQL-backed screens will fail')
  }
}

function warnStaleBuilds(dllDir) {
  const mainBundle = path.join(ROOT, 'app', 'dist', 'index.js')
  if (!fs.existsSync(mainBundle)) {
    throw new ExitError('app/dist/index.js is missing: run `pnpm run build-app-main` first', 2)
  }
  for (const r of staleReasons(['app', 'common'], fs.statSync(mainBundle).mtimeMs)) {
    log(`WARNING app/dist/index.js older than app code (run pnpm run build-app-main): ${r}`)
  }
  const dll = path.join(dllDir ?? path.join(ROOT, 'game', 'dist'), 'shieldbattery_64.dll')
  if (!fs.existsSync(dll)) {
    log(`WARNING no game DLL at ${dll}; game launches will fail`)
  } else if (!dllDir) {
    const reasons = staleReasons(
      [':(glob)game/**/*.rs', ':(glob)game/**/Cargo.toml', 'game/Cargo.lock'],
      fs.statSync(dll).mtimeMs,
    )
    for (const r of reasons)
      log(`WARNING game/dist DLL older than game code (game\\build.bat): ${r}`)
  }
}

function spawnApp(I, opts) {
  const childEnv = { ...process.env }
  // Set by VS Code's extension host and inherited by agent tools; left set, electron.exe runs as
  // plain Node and exits with "Not running in an Electron environment!".
  delete childEnv.ELECTRON_RUN_AS_NODE
  childEnv.SB_HOT = '1'
  childEnv.SB_SESSION = I.session
  if (opts.foreground) {
    delete childEnv.SB_APP_BACKGROUND
    delete childEnv.SB_GAME_BACKGROUND
  } else {
    // The app window and its games open behind whatever the user is doing, without focus or
    // cursor capture.
    childEnv.SB_APP_BACKGROUND = '1'
    childEnv.SB_GAME_BACKGROUND = '1'
  }
  if (opts.dllDir) childEnv.SB_GAME_DLL_DIR = path.resolve(opts.dllDir)
  for (const kv of opts.env) {
    const i = kv.indexOf('=')
    if (i <= 0) throw new UsageError(`--env expects K=V, got ${kv}`)
    childEnv[kv.slice(0, i)] = kv.slice(i + 1)
  }
  const args = [path.join(ROOT, 'app'), `--remote-debugging-port=${I.port}`]
  if (opts.hidden) args.push('--hidden')
  // Spawned directly (no shell, npx or pnpm layer) and detached: the pid is electron's main
  // process, it outlives this script, and killing its tree takes down the renderer, GPU process
  // and any StarCraft it launched.
  const child = spawn(ELECTRON, args, {
    cwd: ROOT,
    env: childEnv,
    detached: true,
    stdio: 'ignore',
  })
  child.on('error', () => {})
  if (!child.pid) throw new Error('failed to spawn electron.exe')
  child.unref()
  const start = processTable().get(child.pid)?.start ?? Date.now()
  const rec = {
    pid: child.pid,
    start,
    port: I.port,
    session: I.session,
    cli: I.cli,
    root: ROOT,
    launchedAt: new Date().toISOString(),
    foreground: !!opts.foreground,
    hidden: !!opts.hidden,
    env: opts.env,
    dllDir: opts.dllDir ? path.resolve(opts.dllDir) : null,
    gamePids: [],
  }
  updateRecord(I.n, rec)
  return rec
}

async function waitForCdp(I, rec, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!pidAlive(rec.pid)) {
      throw new ExitError(
        `electron ${rec.pid} exited during startup. App log tail:\n${appLogTail(I.session)}`,
      )
    }
    const owner = portOwner(I.port)
    if (owner === rec.pid) return
    if (owner) {
      const table = processTable()
      if (!descendants(table, rec.pid).some(p => p.pid === owner)) {
        throw new ExitError(`:${I.port} is held by pid ${owner}, not the launched app ${rec.pid}`)
      }
      return
    }
    await sleep(500)
  }
  throw new ExitError(`the app never opened its CDP port :${I.port}`)
}

/** Whether the app shell rendered (store up, app bar showing a login or user button). */
async function waitRendered(port, timeoutMs) {
  try {
    return await withPage(port, async page => {
      await page.waitForFunction(RENDERED, null, { timeout: timeoutMs, polling: 250 })
      await clearOverlays(page)
      return true
    })
  } catch {
    return false
  }
}

// playwright-cli is an npm .cmd shim, which only runs through a shell; the arguments are fixed
// strings with nothing to escape.
const playwrightCli = args => spawnSync(`playwright-cli ${args}`, { encoding: 'utf8', shell: true })

function attachCli(I) {
  playwrightCli(`-s=${I.cli} detach`)
  const r = playwrightCli(`-s=${I.cli} attach --cdp=http://localhost:${I.port}`)
  if (r.status !== 0) {
    log(`WARNING playwright-cli attach failed: ${(r.stdout + r.stderr).trim().split('\n')[0]}`)
    return false
  }
  return true
}

function detachCli(I) {
  playwrightCli(`-s=${I.cli} detach`)
}

async function launch(n, o) {
  const I = inst(n)
  requireServers()
  warnStaleBuilds(o.dllDir)
  const began = Date.now()
  let rec = liveRecord(n)
  if (rec && portOwner(I.port) === rec.pid) {
    log(`instance ${n}: already running (pid ${rec.pid}, :${I.port}); reusing it`)
    if (o.env.length || o.dllDir || o.hidden || o.foreground) {
      log(
        'WARNING --env/--dll-dir/--hidden/--foreground only apply to a new process; ' +
          `run "sb-app stop ${n}" first to relaunch with them`,
      )
    }
  } else {
    if (rec) {
      killTree(rec.pid)
      updateRecord(n, null)
    }
    const owner = portOwner(I.port)
    if (owner) {
      throw new ExitError(
        `:${I.port} is already held by pid ${owner}, which sb-app didn't launch. Stop that app or ` +
          'pick another instance number.',
      )
    }
    rec = null
    for (let attempt = 1; attempt <= 3 && !rec; attempt++) {
      // A dependency Vite discovers while the window loads makes it re-optimize and the window
      // stays blank; crawling the module graph first settles that (a couple of seconds when warm).
      await warmRenderer(RENDERER, Date.now() + 300000, () => {})
      const r = spawnApp(I, o)
      log(`instance ${n}: launched electron pid ${r.pid} (${I.session}, CDP :${I.port})`)
      await waitForCdp(I, r, 90000)
      if (await waitRendered(I.port, 60000)) {
        rec = r
        break
      }
      // A reload over CDP tends to break the attached sessions; a fresh process is reliable.
      log(`instance ${n}: app stayed blank${attempt < 3 ? '; relaunching' : ''}`)
      killTree(r.pid)
      await waitForPortFree(I.port, 10000)
      updateRecord(n, null)
    }
    if (!rec)
      throw new ExitError(
        `instance ${n}: the app never rendered. App log tail:\n${appLogTail(I.session)}`,
      )
    log(`instance ${n}: app rendered after ${fmtDuration(Date.now() - began)}`)
  }
  const user = o.noLogin
    ? ((await withPage(I.port, page => currentUser(page)))?.name ?? null)
    : await withPage(I.port, page => ensureLogin(page, I, o.login, o.password))
  const cli = attachCli(I)
  log(
    `instance ${n}: ready in ${fmtDuration(Date.now() - began)}  pid ${rec.pid}  cdp :${I.port}  ` +
      `cli ${cli ? `-s=${I.cli}` : '(not attached)'}  user ${user ?? '(logged out)'}`,
  )
  return 0
}

// ---- Login ----

async function logOut(page) {
  await click(page, page.getByTestId('app-bar-user-button'))
  await click(page, page.getByTestId('app-bar-logout'))
  await page.waitForFunction(() => !window.__sbReduxStore.getState().auth.self, null, {
    timeout: 20000,
  })
  await page.getByTestId('app-bar-login').waitFor({ timeout: 20000 })
}

async function logIn(page, user, password) {
  const name = page.locator('input[name="username"]')
  // Logging out of a route that requires login (a lobby, /play) lands on the login form directly,
  // and the app bar's login button is disabled there.
  await page.waitForFunction(
    () =>
      !!document.querySelector('input[name="username"]') ||
      document.querySelector('[data-testid=app-bar-login]')?.disabled === false,
    null,
    { timeout: 20000 },
  )
  if (!(await name.isVisible())) await click(page, page.getByTestId('app-bar-login'), 20000)
  await name.waitFor({ timeout: 15000 })
  await name.fill(user)
  await page.locator('input[name="password"]').fill(password)
  await click(page, page.getByTestId('submit-button'))
  try {
    await page.waitForFunction(() => !!window.__sbReduxStore.getState().auth.self, null, {
      timeout: 30000,
    })
  } catch {
    const errorText = await page
      .evaluate(() =>
        [...document.querySelectorAll('[data-testid=errors-container],[role=alert]')]
          .map(e => e.textContent)
          .join(' '),
      )
      .catch(() => '')
    throw new ExitError(`login as ${user} failed${errorText ? `: ${errorText}` : ' (timed out)'}`)
  }
}

/**
 * Clicks away the dialogs that can follow a fresh login: the game defaults first-run dialog (a new
 * SB_SESSION) and the Discord activity prompt (an account that hasn't decided, while Discord runs).
 * The Discord prompt waits on account settings and an IPC check, so it can appear a moment later.
 */
async function dismissLoginPrompts(page) {
  let deadline = Date.now() + 6000
  const dismissed = new Set()
  // These dialogs animate in and can re-render while lazily loading, so a click may land on a
  // detached element; the loop looks again rather than failing, until the dialog is gone.
  const dismiss = async (testId, what) => {
    await page
      .getByTestId(testId)
      .click({ timeout: 3000 })
      .catch(() => {})
    dismissed.add(what)
    deadline = Math.max(deadline, Date.now() + 3000)
  }
  while (Date.now() < deadline) {
    const found = await page.evaluate(() => {
      const has = id => !!document.querySelector(`[data-testid=${id}]`)
      return {
        defaults: has('game-defaults-first-run-dialog'),
        discord: has('discord-activity-prompt'),
        email: has('email-verification-dialog'),
        decided: window.__sbReduxStore.getState().settings?.account?.shareDiscordActivity,
      }
    })
    if (found.defaults) {
      await dismiss('game-defaults-continue', 'game defaults')
    } else if (found.discord) {
      await dismiss('discord-activity-decline', 'Discord activity prompt (declined)')
    } else if (found.email) {
      await dismiss('cancel-button', 'email verification')
    } else if (found.decided && found.decided !== 'notAsked' && Date.now() > deadline - 4500) {
      break
    }
    await sleep(300)
  }
  if (dismissed.size) log(`dismissed after login: ${[...dismissed].join(', ')}`)
  const left = await page.evaluate(() =>
    [
      'game-defaults-first-run-dialog',
      'discord-activity-prompt',
      'email-verification-dialog',
    ].filter(id => document.querySelector(`[data-testid=${id}]`)),
  )
  if (left.length) log(`WARNING still open after login: ${left.join(', ')}`)
}

/** Returns the logged-in user's name after making sure the right account is logged in. */
async function ensureLogin(page, I, want, password = DEFAULT_PASSWORD) {
  await page.waitForFunction(RENDERED, null, { timeout: 30000 })
  const cur = await currentUser(page)
  if (cur && (!want || sameUser(cur, want))) {
    log(`instance ${I.n}: already logged in as ${cur.name}; keeping it`)
    return cur.name
  }
  if (cur) {
    log(`instance ${I.n}: logging out ${cur.name}`)
    await logOut(page)
  }
  const user = want ?? I.account
  const t = Date.now()
  await logIn(page, user, password)
  await dismissLoginPrompts(page)
  const now = await currentUser(page)
  log(`instance ${I.n}: logged in as ${now.name} (${fmtDuration(Date.now() - t)})`)
  return now.name
}

async function login(n, user, password) {
  const rec = requireInstance(n)
  await withPage(rec.port, page => ensureLogin(page, inst(n), user, password))
  return 0
}

// ---- Game state ----

async function gameSnapshot(page) {
  return page.evaluate(() => {
    const g = window.__sbReduxStore.getState().gameClient
    return { gameId: g.gameId ?? null, status: g.status ?? null, watchOnly: g.watchOnly ?? {} }
  })
}

function refuseExclusiveFullscreen(session) {
  const scr = readJson(path.join(APPDATA_DIR, `scr-settings-${session}.json`), {})
  if (scr.displayMode === 2) {
    throw new ExitError(
      `${session}'s StarCraft settings use exclusive fullscreen (displayMode 2), which takes over ` +
        'the display; switch it to windowed (0) or windowed fullscreen (1) first',
      2,
    )
  }
}

function checkNoBuild() {
  const r = spawnSync('tasklist', ['/FI', 'IMAGENAME eq rustc.exe', '/FO', 'CSV', '/NH'], {
    encoding: 'utf8',
  })
  if (/rustc\.exe/i.test(r.stdout ?? '')) {
    log(
      'NOTE: rustc.exe is running (a cargo build somewhere); if game\\build.bat is copying the DLL ' +
        'a game launch can die at start',
    )
  }
}

/**
 * Polls until the game reaches `target` (or a later active state). Fails on an error state, a game
 * that ended before reaching `target`, the game process or the app dying, or timeout. A game that
 * had already ended when the wait began counts as no game (unless `target` is `finished`), so a
 * wait can start before the next game does. `replay` watches gameClient.watchOnly instead;
 * `notIds` skips games that existed before the caller started a new one.
 */
async function waitFor(rec, target, { replay = false, timeoutSecs = 180, notIds = [] } = {}) {
  if (!ORDER.includes(target)) throw new UsageError(`unknown state ${target} (${ORDER.join(', ')})`)
  const began = Date.now()
  const deadline = began + timeoutSecs * 1000
  return withPage(rec.port, async page => {
    let last = ''
    let seenId = null
    let gamePids = []
    let pidsGoneAt = null
    let nextPidCheck = 0
    let endedBefore
    while (true) {
      if (!pidAlive(rec.pid)) throw new ExitError(`the app (pid ${rec.pid}) exited`)
      const snap = await gameSnapshot(page)
      let cur = null
      if (replay) {
        const entries = Object.values(snap.watchOnly).filter(s => !notIds.includes(s.id))
        cur = entries.find(s => s.id === seenId) ?? entries.at(-1) ?? null
        if (!cur && seenId) {
          if (target === 'finished') return { id: seenId, state: 'finished' }
          throw new ExitError(`replay ${seenId} ended (process gone) before reaching ${target}`)
        }
      } else if (snap.status && !notIds.includes(snap.status.id)) {
        // 'unknown' is what a quit or killed game ends on.
        if (endedBefore === undefined) {
          endedBefore =
            !ACTIVE.has(snap.status.state) && target !== 'finished' ? snap.status.id : null
        }
        if (snap.status.id !== endedBefore) cur = snap.status
      }
      const elapsed = fmtDuration(Date.now() - began)
      const line = cur ? `${cur.state} (game ${cur.id})` : 'no running game'
      if (line !== last) {
        log(`[${elapsed}] ${line}`)
        last = line
      }
      if (cur) {
        seenId = cur.id
        if (cur.state === 'error') {
          throw new ExitError(
            `game ${cur.id} reported an error: ${JSON.stringify(cur.extra ?? {})}`,
          )
        }
        const ti = ORDER.indexOf(target)
        const ci = ORDER.indexOf(cur.state)
        if (cur.state === target || (ci > ti && ACTIVE.has(cur.state))) return cur
        if (!ACTIVE.has(cur.state)) {
          if (target === 'finished') return cur
          throw new ExitError(`game ${cur.id} ended (${cur.state}) without reaching ${target}`)
        }
        if (ACTIVE.has(cur.state) && Date.now() >= nextPidCheck) {
          nextPidCheck = Date.now() + 4000
          const table = processTable()
          const pids = gameExePids(table, rec.pid)
          if (pids.length) {
            gamePids = pids
            pidsGoneAt = null
            if (!rec.external) {
              const known = loadState().instances[rec.n ?? '']?.gamePids ?? []
              const merged = [...known, ...pids.filter(p => !known.some(k => k.pid === p.pid))]
              if (rec.n) updateRecord(rec.n, { gamePids: merged })
            }
          } else if (gamePids.length) {
            pidsGoneAt ??= Date.now()
            if (Date.now() - pidsGoneAt > 8000) {
              throw new ExitError(
                `the game process (${gamePids.map(p => p.pid).join(', ')}) exited while the app ` +
                  `still reports ${cur.state}`,
              )
            }
          }
        }
      }
      if (Date.now() > deadline) {
        throw new ExitError(`timed out after ${timeoutSecs}s waiting for ${target}; last: ${line}`)
      }
      await sleep(1000)
    }
  })
}

async function waitCmd(n, target, o) {
  const rec = { ...requireInstance(n), n }
  const cur = await waitFor(rec, target, { replay: o.replay, timeoutSecs: o.timeout ?? 180 })
  log(
    cur.state === target || ACTIVE.has(cur.state)
      ? `reached ${cur.state} (game ${cur.id})`
      : `game ${cur.id} ended (${cur.state})`,
  )
  return 0
}

// ---- Lobby ----

async function lobby(n, o) {
  const I = inst(n)
  const rec = { ...requireInstance(n), n }
  if (o.start) {
    refuseExclusiveFullscreen(I.session)
    checkNoBuild()
  }
  const computers = o.computers ?? 1
  const name = o.name ?? `sb-app ${n} ${new Date().toTimeString().slice(0, 8)}`
  const created = await withPage(rec.port, async page => {
    const user = await currentUser(page)
    if (!user) throw new ExitError(`instance ${n} is not logged in (sb-app login ${n} <user>)`)
    const snap = await gameSnapshot(page)
    if (snap.status && ACTIVE.has(snap.status.state)) {
      throw new ExitError(
        `instance ${n} is in game ${snap.status.id} (${snap.status.state}); end it first (sb-app end ${n})`,
      )
    }
    const result = await page.evaluate(
      async ({ renderer, name, mapId, computers, listed }) => {
        // The app may have loaded a module under an HMR `?t=` query; importing that exact URL shares its
        // instance instead of evaluating a second copy.
        const mod = p => {
          const base = renderer + p
          const hit = performance
            .getEntriesByType('resource')
            .find(e => e.name === base || e.name.startsWith(base + '?'))
          return import(hit ? hit.name : base)
        }
        const [lobbies, fetchMod, urls, lobbyUrl] = await Promise.all([
          mod('/client/lobbies/action-creators.ts'),
          mod('/client/network/fetch.ts'),
          mod('/common/urls.ts'),
          mod('/client/lobbies/lobby-url.ts'),
        ])
        const store = window.__sbReduxStore
        const need = 1 + computers
        let map = mapId
        let mapName = mapId
        if (!map) {
          // An official (plain melee) map the account used recently, then the official map list,
          // then any other recent map. Recent maps can be UMS maps, which do run as Melee but
          // behave differently at game end.
          const prefs = await fetchMod.fetchJson(urls.apiUrl`lobby-preferences`)
          const fits = m => m && m.mapData.slots >= need && !m.mapData.isEud
          const recent = [...(prefs.recentMaps ?? [])].sort(
            (x, y) => (y.id === prefs.selectedMap) - (x.id === prefs.selectedMap),
          )
          let pick = recent.find(m => m.visibility === 'OFFICIAL' && fits(m))
          if (!pick) {
            const list = await fetchMod.fetchJson(urls.apiUrl`maps?visibility=OFFICIAL`)
            pick = (list.maps ?? []).find(fits) ?? recent.find(fits)
          }
          if (!pick) return { error: `no map with at least ${need} slots found` }
          map = pick.id
          mapName = pick.name
        }
        const inLobby = !!store.getState().lobby.info?.name
        const res = await new Promise(resolve =>
          store.dispatch(
            lobbies.createLobby(
              {
                name,
                map,
                gameType: 'melee',
                allowObservers: true,
                visibility: listed ? 'listed' : 'unlisted',
                leaveCurrentLobby: inLobby,
              },
              {
                onSuccess: r => resolve({ ok: true, id: r.id }),
                onError: e =>
                  resolve({
                    ok: false,
                    status: e?.status,
                    body: (() => {
                      try {
                        return e?.body
                      } catch {
                        return undefined
                      }
                    })(),
                    message: String(e?.message ?? e),
                  }),
              },
            ),
          ),
        )
        if (!res.ok) return { error: 'create', ...res }
        lobbyUrl.navigateToLobby(res.id, name)
        return { id: res.id, map: mapName }
      },
      { renderer: RENDERER, name, mapId: o.map ?? null, computers, listed: !!o.listed },
    )
    if (result.error === 'create') {
      if (result.status === 409) {
        throw new ExitError(
          `the server says ${user.name} is already in an activity (409 ${result.body?.code ?? ''}). ` +
            'A game that was killed instead of finished keeps the account in it for a while ' +
            '(15+ minutes). Use another instance/account instead of waiting.',
          3,
        )
      }
      throw new ExitError(
        `creating the lobby failed: ${result.status ?? ''} ${result.message} ${JSON.stringify(result.body ?? '')}`,
      )
    }
    if (result.error) throw new ExitError(result.error)
    log(`lobby "${name}" created (id ${result.id}, map ${result.map}, Melee) as ${user.name}`)

    await page.waitForFunction(
      id => window.__sbReduxStore.getState().lobby.info?.id === id,
      result.id,
      {
        timeout: 20000,
      },
    )
    await page.getByTestId('lobby-slot').first().waitFor({ timeout: 20000 })
    await addComputers(page, computers)
    return result
  })
  if (!o.start) return 0

  const before = await withPage(rec.port, page => gameSnapshot(page))
  await withPage(rec.port, async page => {
    await click(page, page.getByTestId('start-game-button'))
    log('start clicked')
  })
  const cur = await waitFor(rec, 'playing', {
    timeoutSecs: o.timeout ?? 240,
    notIds: before.status ? [before.status.id] : [],
  })
  log(`lobby ${created.id}: game ${cur.id} is ${cur.state}`)
  return 0
}

const computerCount = page =>
  page.evaluate(
    () =>
      window.__sbReduxStore
        .getState()
        .lobby.info.teams.flatMap(t => t.slots)
        .filter(s => s.type === 'computer').length,
  )

/**
 * Fills open slots with computers through each slot's hover-revealed actions menu, falling back to
 * the addComputer action creator when the menu doesn't offer it.
 */
async function addComputers(page, k) {
  const startCount = await computerCount(page)
  let added = 0
  const rows = page.getByTestId('lobby-slot')
  for (let i = 0; added < k && i < (await rows.count()); i++) {
    const row = rows.nth(i)
    const button = row.getByTestId('lobby-slot-actions')
    if ((await button.count()) === 0) continue
    await row.hover()
    await click(page, button, 5000)
    const item = page.getByTestId('lobby-slot-action-add-computer')
    try {
      await item.waitFor({ timeout: 1500 })
    } catch {
      await page.keyboard.press('Escape')
      continue
    }
    await click(page, item, 5000)
    const want = startCount + added + 1
    await page.waitForFunction(
      w => {
        const slots = window.__sbReduxStore.getState().lobby.info.teams.flatMap(t => t.slots)
        return slots.filter(s => s.type === 'computer').length >= w
      },
      want,
      { timeout: 10000 },
    )
    added++
  }
  if (added < k) {
    const extra = await page.evaluate(
      async ({ renderer, count }) => {
        // The app may have loaded a module under an HMR `?t=` query; importing that exact URL shares its
        // instance instead of evaluating a second copy.
        const mod = p => {
          const base = renderer + p
          const hit = performance
            .getEntriesByType('resource')
            .find(e => e.name === base || e.name.startsWith(base + '?'))
          return import(hit ? hit.name : base)
        }
        const lobbies = await mod('/client/lobbies/action-creators.ts')
        const store = window.__sbReduxStore
        let done = 0
        for (let j = 0; j < count; j++) {
          const open = store
            .getState()
            .lobby.info.teams.filter(t => !t.isObserver)
            .flatMap(t => t.slots)
            .find(s => s.type === 'open' || s.type === 'closed')
          if (!open) break
          const ok = await new Promise(resolve =>
            store.dispatch(
              lobbies.addComputer(open.id, {
                onSuccess: () => resolve(true),
                onError: () => resolve(false),
              }),
            ),
          )
          if (!ok) break
          await new Promise(r => setTimeout(r, 500))
          done++
        }
        return done
      },
      { renderer: RENDERER, count: k - added },
    )
    if (extra) log(`added ${extra} computer(s) through addComputer (the slot menu offered fewer)`)
    added += extra
  }
  log(`computers in lobby: ${await computerCount(page)} (added ${added} of ${k})`)
  if (added < k) throw new ExitError(`only ${added} of ${k} computers fit in the lobby`)
}

// ---- Replay ----

async function replay(n, file, o) {
  const I = inst(n)
  const rec = { ...requireInstance(n), n }
  const abs = path.resolve(file)
  if (!fs.existsSync(abs)) throw new ExitError(`no such replay: ${abs}`, 2)
  refuseExclusiveFullscreen(I.session)
  checkNoBuild()
  const before = await withPage(rec.port, async page => {
    const snap = await gameSnapshot(page)
    if (snap.status && ACTIVE.has(snap.status.state)) {
      throw new ExitError(
        `instance ${n} is in game ${snap.status.id} (${snap.status.state}); end it first (sb-app end ${n})`,
      )
    }
    // Forward slashes: the path goes through several layers of string escaping on its way to the
    // game, and backslashes don't survive all of them.
    const replayPath = abs.replaceAll('\\', '/')
    await page.evaluate(
      async ({ renderer, replayPath, startFrame }) => {
        // The app may have loaded a module under an HMR `?t=` query; importing that exact URL shares its
        // instance instead of evaluating a second copy.
        const mod = p => {
          const base = renderer + p
          const hit = performance
            .getEntriesByType('resource')
            .find(e => e.name === base || e.name.startsWith(base + '?'))
          return import(hit ? hit.name : base)
        }
        const m = await mod('/client/replays/action-creators.ts')
        window.__sbReduxStore.dispatch(
          m.startReplay({
            path: replayPath,
            name: 'sb-app replay',
            startFrame: startFrame ?? undefined,
          }),
        )
      },
      { renderer: RENDERER, replayPath, startFrame: o.startFrame ?? null },
    )
    log(`replay started: ${replayPath}${o.startFrame ? ` from frame ${o.startFrame}` : ''}`)
    return snap
  })
  const cur = await waitFor(rec, 'playing', {
    replay: true,
    timeoutSecs: o.timeout ?? 180,
    notIds: Object.keys(before.watchOnly),
  })
  log(`replay game ${cur.id} is ${cur.state}`)
  return 0
}

// ---- End / stop ----

/** Ends instance `rec`'s running game and replays. Returns a description of what it did. */
async function endGames(rec, { leave = false, budgetMs = 30000 } = {}) {
  const deadline = Date.now() + budgetMs
  const did = []
  await withPage(rec.port, async page => {
    const snap = await gameSnapshot(page)
    const game = snap.status && ACTIVE.has(snap.status.state) ? snap.status : null
    const replays = Object.keys(snap.watchOnly)
    if (!game && !replays.length) return
    if (game && leave) {
      // A local, non-consensus leave of the client's own slot. With other humans in the game this
      // usually ends it for the caller (often voided as a desync); with computers as the only other
      // players BW keeps simulating for them and no result follows, so this falls through to
      // forceQuit once the wait runs out.
      const left = await page
        .evaluate(async id => {
          const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000))
          const q = await Promise.race([window.__sbDebugGame.queryGameState(id), timeout])
          const slot = q?.turnState?.localSlot ?? q?.localSlot
          if (slot === undefined) return { error: `no localSlot in ${JSON.stringify(q)}` }
          await Promise.race([window.__sbDebugGame.forceUnsyncedLeave(id, slot), timeout])
          return { slot }
        }, game.id)
        .catch(e => ({ error: e.message }))
      if (left.error) did.push(`leave failed (${left.error})`)
      else {
        did.push(`left game ${game.id} (slot ${left.slot})`)
        while (Date.now() < deadline - 10000) {
          const s = (await gameSnapshot(page)).status
          if (!s || s.id !== game.id || !ACTIVE.has(s.state)) break
          await sleep(1000)
        }
      }
    }
    const after = await gameSnapshot(page)
    const ids = [
      ...(after.status && ACTIVE.has(after.status.state) ? [after.status.id] : []),
      ...Object.keys(after.watchOnly),
    ]
    for (const id of ids) {
      await page.evaluate(id => window.__sbDebugGame.forceQuit(id), id).catch(() => {})
      did.push(`forceQuit ${id}`)
    }
    while (ids.length && Date.now() < deadline) {
      const s = await gameSnapshot(page)
      const active = (s.status && ACTIVE.has(s.status.state)) || Object.keys(s.watchOnly).length
      if (!active) break
      await sleep(1000)
    }
  })
  return did
}

async function end(n, o) {
  const rec = { ...requireInstance(n), n }
  const did = await endGames(rec, { leave: !!o.leave, budgetMs: o.leave ? 40000 : 20000 })
  const table = processTable()
  const left = gameExePids(table, rec.pid)
  for (const p of left) killTree(p.pid)
  if (left.length) did.push(`killed StarCraft ${left.map(p => p.pid).join(', ')}`)
  const final = await withPage(rec.port, page => gameSnapshot(page))
  log(did.length ? did.join('; ') : 'no game running')
  log(
    `game state now: ${final.status ? `${final.status.state} (game ${final.status.id})` : 'none'}`,
  )
  return 0
}

async function stopOne(n) {
  const I = inst(n)
  const table = processTable()
  const rec = liveRecord(n, table)
  const stored = loadState().instances[n]
  if (!rec) {
    detachCli(I)
    // Game processes recorded for this instance outlive a crashed app; kill those that are still
    // the same processes.
    for (const g of stored?.gamePids ?? []) {
      if (sameProcess(table, g.pid, g.start)) killTree(g.pid)
    }
    updateRecord(n, null)
    const owner = portOwner(I.port)
    log(
      `instance ${n}: not running${owner ? ` (but :${I.port} is held by pid ${owner}, which sb-app didn't launch; left alone)` : ''}`,
    )
    return 0
  }
  if (portOwner(I.port) === rec.pid) {
    try {
      const did = await endGames({ ...rec, n }, { budgetMs: 30000 })
      if (did.length) log(`instance ${n}: ${did.join('; ')}`)
    } catch (e) {
      log(`instance ${n}: couldn't end games over CDP (${e.message}); killing anyway`)
    }
  }
  detachCli(I)
  const games = gameExePids(processTable(), rec.pid)
  killTree(rec.pid)
  for (const g of [...games, ...(stored.gamePids ?? [])]) {
    if (pidAlive(g.pid) && sameProcess(processTable(), g.pid, g.start)) killTree(g.pid)
  }
  const free = await waitForPortFree(I.port, 15000)
  updateRecord(n, null)
  if (!free) {
    log(`instance ${n}: ERROR :${I.port} still held by pid ${portOwner(I.port)}`)
    return 1
  }
  log(
    `instance ${n}: stopped (pid ${rec.pid}${games.length ? `, StarCraft ${games.map(g => g.pid).join(', ')}` : ''}); :${I.port} free`,
  )
  return 0
}

async function stop(ns) {
  let code = 0
  for (const n of ns) code = Math.max(code, await stopOne(n))
  return code
}

// ---- Status ----

async function status() {
  const table = processTable()
  const ls = listeners()
  const state = loadState()
  const cliList = playwrightCli('list').stdout ?? ''
  const rows = []
  for (let n = 1; n <= 12; n++) {
    const I = inst(n)
    const rec = state.instances[n]
    const alive = rec && sameProcess(table, rec.pid, rec.start)
    const owner = portOwner(I.port, ls)
    if (!rec && !owner) continue
    let info = ''
    if (owner && (!rec || owner === rec.pid)) {
      try {
        info = await withPage(I.port, async page => {
          const user = await currentUser(page)
          const snap = await gameSnapshot(page)
          const game = snap.status ? `game ${snap.status.state} (${snap.status.id})` : 'no game'
          const reps = Object.keys(snap.watchOnly).length
          return `user ${user?.name ?? '(logged out)'}  ${game}${reps ? `  replays ${reps}` : ''}`
        })
      } catch (e) {
        info = `(CDP error: ${e.message.split('\n')[0]})`
      }
    }
    let who = 'dead (stale record)'
    if (rec && alive) who = 'sb-app'
    else if (owner) who = 'not launched by sb-app'
    const cli = new RegExp(`\\b${I.cli}\\b`).test(cliList) ? `cli -s=${I.cli}` : 'cli not attached'
    rows.push(
      `${String(n).padStart(2)}  ${I.session.padEnd(9)} :${I.port}  pid ${owner ?? rec?.pid}  ${who}  ${cli}  ${info}`,
    )
  }
  log(rows.length ? rows.join('\n') : 'no app instances running on ports 9222-9233')
  return 0
}

// ---- CLI ----

function parseArgs(argv) {
  const valued = new Set([
    '--env',
    '--dll-dir',
    '--login',
    '--password',
    '--name',
    '--computers',
    '--map',
    '--timeout',
    '--start-frame',
  ])
  const o = { env: [], _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (valued.has(a)) {
      if (i + 1 >= argv.length) throw new UsageError(`${a} needs a value`)
      const v = argv[++i]
      const key = a.slice(2).replace(/-(\w)/g, (_, c) => c.toUpperCase())
      if (a === '--env') o.env.push(v)
      else o[key] = v
    } else if (a.startsWith('--')) {
      o[a.slice(2).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = true
    } else {
      o._.push(a)
    }
  }
  for (const k of ['computers', 'timeout', 'startFrame']) {
    if (o[k] !== undefined) {
      o[k] = Number(o[k])
      if (!Number.isFinite(o[k])) throw new UsageError(`--${k} expects a number`)
    }
  }
  return o
}

function instanceArg(v) {
  const n = Number(v)
  if (!Number.isInteger(n) || n < 1 || n > 12)
    throw new UsageError(`instance must be 1..12, got ${v}`)
  return n
}

async function main() {
  const argv = process.argv.slice(2)
  const cmd = argv[0]
  if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help') {
    log(HELP)
    return cmd ? 0 : 2
  }
  const o = parseArgs(argv.slice(1))
  if (o.help) {
    log(HELP)
    return 0
  }
  fs.mkdirSync(STATE_DIR, { recursive: true })
  switch (cmd) {
    case 'launch':
      if (o._.length !== 1) throw new UsageError('launch <N>')
      if (!fs.existsSync(ELECTRON))
        throw new ExitError(`no electron at ${ELECTRON} (pnpm install?)`, 2)
      return launch(instanceArg(o._[0]), o)
    case 'login':
      if (o._.length !== 2) throw new UsageError('login <N> <user>')
      return login(instanceArg(o._[0]), o._[1], o.password)
    case 'lobby':
      if (o._.length !== 1) throw new UsageError('lobby <N>')
      return lobby(instanceArg(o._[0]), o)
    case 'replay':
      if (o._.length !== 2) throw new UsageError('replay <N> <file.rep>')
      return replay(instanceArg(o._[0]), o._[1], o)
    case 'wait':
      if (o._.length !== 2) throw new UsageError('wait <N> <state>')
      return waitCmd(instanceArg(o._[0]), o._[1], o)
    case 'end':
      if (o._.length !== 1) throw new UsageError('end <N>')
      return end(instanceArg(o._[0]), o)
    case 'stop': {
      const ns = o.all ? Object.keys(loadState().instances).map(Number) : o._.map(instanceArg)
      if (!ns.length) {
        if (o.all) {
          log('no instances recorded as launched by sb-app')
          return 0
        }
        throw new UsageError('stop <N...> | --all')
      }
      return stop(ns)
    }
    case 'status':
      return status()
    default:
      throw new UsageError(`unknown command: ${cmd}`)
  }
}

main().then(
  code => process.exit(code),
  err => {
    if (err instanceof UsageError) {
      console.error(`usage error: ${err.message}\n(run with --help)`)
      process.exit(2)
    }
    console.error(`error: ${err instanceof ExitError ? err.message : (err.stack ?? err)}`)
    process.exit(err instanceof ExitError ? err.code : 1)
  },
)
