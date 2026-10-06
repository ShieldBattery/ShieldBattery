// Rollback soak runner: plays prod replays plainly and under randomized rollback-harness settings,
// and checks every confirmed frame's fingerprint against the plain run. See SKILL.md beside it.
//
// usage: node soak.mjs [--workers N] [--configs K] [--games M] [--only <gameId>] [--env K=V,...]
//
// Works in a data directory (default .claude-scratch/rollback-soak, `--data-dir` to change it).
// Reads its queue.tsv (gameId, source, type, seconds, players), skips games already in
// results.jsonl, and for each game: downloads its replay from sb-prod's internal API, runs it once
// plainly (SB_ROLLBACK_PROBE) to get the baseline fingerprints, then K times with the harness
// armed. Every run is a fresh Electron instance on its own SB_SESSION, injecting the pinned DLLs in
// dll/. Passing runs' CSVs are deleted; failures keep everything under failures/.
import { spawn, execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const APPDATA_DIR = path.join(process.env.APPDATA, 'ShieldBattery-Local')
const LOGS = path.join(APPDATA_DIR, 'logs')
const BENCH_LOCK = path.join(ROOT, '.claude-scratch/rollback-bench/lock')
const PROD = 'http://sb-prod'
// Snapshot holes already found but not yet fixed in the DLL, covered with extra ranges so the soak
// keeps looking for new ones. Offsets are per architecture; an arch without an entry runs as is.
const KNOWN_HOLES = {}

const args = process.argv.slice(2)
const opt = (name, def) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : def
}
const WORKERS = Number(opt('--workers', 4))
const CONFIGS = Number(opt('--configs', 3))
const MAX_GAMES = Number(opt('--games', 1e9))
const ONLY = opt('--only', null)
const EXTRA_ENV = Object.fromEntries(
  (opt('--env', '') || '')
    .split(',')
    .filter(Boolean)
    .map(x => x.split('='))
    // `;` stands in for `,` inside values, as in --fixed-env.
    .map(([k, v]) => [k, v.replaceAll(';', ',')]),
)
const SOAK = path.resolve(opt('--data-dir', path.join(ROOT, '.claude-scratch/rollback-soak')))
const STOP_FILE = path.join(SOAK, 'STOP')
// The session whose settings (StarCraft path above all) the soak sessions start from.
const SETTINGS_FROM = opt('--settings-from', 'session1')
// Validation knobs: a local replay instead of the queue, one fixed harness config instead of
// random ones, another DLL directory, and worker numbers that don't collide with a running soak.
const REPLAY_FILE = opt('--replay-file', null)
const FIXED_ENV = opt('--fixed-env', null)
const DLL_DIR = path.resolve(opt('--dll-dir', path.join(SOAK, 'dll')))
const WORKER_BASE = Number(opt('--worker-base', 0))
const RESULTS_FILE = opt('--results', null)
// A plain run's probe CSV to compare against instead of running the replay plainly again. It is
// left where it is, whatever the outcome.
const BASELINE = opt('--baseline', null)
// The architecture a --fixed-env run plays on.
const FIXED_ARCH = opt('--arch', 'x64')
// The architecture plain runs play on. A harness run is only ever compared against a plain run of
// its own architecture: SC:R's 32 and 64-bit builds don't simulate every game identically (the AI
// reads units.dat past the end of its arrays, where the two lay out different bytes), so a
// cross-architecture comparison reports divergences rollback has nothing to do with. Random
// configs pick one architecture per game for its plain run and all its harness runs.
const PLAIN_ARCH_OPT = opt('--plain-arch', null)

const RESULTS = RESULTS_FILE ? path.resolve(RESULTS_FILE) : path.join(SOAK, 'results.jsonl')
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const sleep = ms => new Promise(r => setTimeout(r, ms))
const rand = n => Math.floor(Math.random() * n)
const pick = xs => xs[rand(xs.length)]

function appendResult(obj) {
  fs.appendFileSync(RESULTS, JSON.stringify({ t: new Date().toISOString(), ...obj }) + '\n')
}

function doneGames() {
  if (!fs.existsSync(RESULTS)) return new Set()
  return new Set(
    fs
      .readFileSync(RESULTS, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(l => JSON.parse(l))
      .filter(r => r.kind === 'game')
      .map(r => r.game),
  )
}

function loadQueue() {
  if (REPLAY_FILE) {
    return [{ id: 'local-' + path.basename(REPLAY_FILE, '.rep'), src: 'LOCAL', typ: 'local', players: 8 }]
  }
  const done = doneGames()
  return fs
    .readFileSync(path.join(SOAK, 'queue.tsv'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(l => {
      const [id, src, typ, secs, players] = l.split('\t')
      return { id, src, typ, secs: Number(secs), players: Number(players) }
    })
    .filter(g => (ONLY ? g.id === ONLY : !done.has(g.id)))
}

// ---- Replays ----

async function fetchReplay(gameId) {
  if (REPLAY_FILE) {
    // Copied so the end-of-game cleanup can't delete the original, under a name of this runner's
    // own so parallel repros of the same file don't delete each other's copy.
    const dest = path.join(SOAK, 'replays', `${gameId}-${process.pid}.rep`)
    fs.copyFileSync(REPLAY_FILE, dest)
    return { path: dest, frames: 60000, replayId: null }
  }
  const dest = path.join(SOAK, 'replays', `${gameId}.rep`)
  const manifest = await (await fetch(`${PROD}/internal/games/${gameId}/artifacts`)).json()
  const replay = manifest.replays?.[0]
  if (!replay) throw new Error('game has no replays')
  if (!fs.existsSync(dest)) {
    const res = await fetch(PROD + replay.downloadPath)
    if (!res.ok) throw new Error(`replay download ${res.status}`)
    fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()))
  }
  return { path: dest, frames: replay.frames, replayId: replay.id }
}

// ---- Running one replay ----

function writeSessionSettings(session, arch) {
  for (const [kind, from] of [
    ['settings', SETTINGS_FROM],
    ['scr-settings', SETTINGS_FROM],
    ['CSettings', SETTINGS_FROM],
  ]) {
    const dest = path.join(APPDATA_DIR, `${kind}-${session}.json`)
    if (!fs.existsSync(dest)) {
      fs.copyFileSync(path.join(APPDATA_DIR, `${kind}-${from}.json`), dest)
    }
  }
  const settingsPath = path.join(APPDATA_DIR, `settings-${session}.json`)
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
  settings.launch32Bit = arch === 'x86'
  settings.masterVolume = 0
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2))
  const scrPath = path.join(APPDATA_DIR, `scr-settings-${session}.json`)
  const scr = JSON.parse(fs.readFileSync(scrPath, 'utf8'))
  scr.fpsLimitOn = false
  scr.soundOn = false
  scr.musicOn = false
  fs.writeFileSync(scrPath, JSON.stringify(scr, null, 2))
}

function gameLogPath(session) {
  return path.join(LOGS, `game-${session}.0.log`)
}

// The pid of the game whose log names `donePath`, the path this run handed the DLL: the
// `SESSION_START` line before the soak's armed line carries it. Matching on the run's own path
// rather than counting starts keeps working when the session's log rotates mid-launch.
function gamePidFor(session, donePath) {
  for (const file of [gameLogPath(session), gameLogPath(session).replace(/\.0\.log$/, '.1.log')]) {
    let text
    try {
      text = fs.readFileSync(file, 'latin1')
    } catch {
      continue
    }
    const at = text.indexOf(donePath)
    if (at < 0) continue
    const starts = [...text.slice(0, at).matchAll(/\[SESSION_START\].* pid=(\d+) /g)]
    if (starts.length) return Number(starts.at(-1)[1])
  }
  return null
}

function gameLogTail(session, lines = 60) {
  try {
    const text = fs.readFileSync(gameLogPath(session), 'latin1')
    const start = text.lastIndexOf('[SESSION_START]')
    return text
      .slice(Math.max(0, start - 200))
      .split('\n')
      .slice(-lines)
      .join('\n')
  } catch (e) {
    return `(no game log: ${e.message})`
  }
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function killTree(pid) {
  try {
    execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' })
  } catch {}
}

async function startReplay(port, replayPath) {
  const browser = await chromium.connectOverCDP(`http://localhost:${port}`)
  try {
    const page = browser
      .contexts()
      .flatMap(c => c.pages())
      .find(p => !p.url().startsWith('devtools'))
    await page.waitForFunction(() => window.__sbReduxStore, null, { timeout: 120000 })
    await page.waitForTimeout(2000)
    const loggedIn = () => page.evaluate(() => !!window.__sbReduxStore.getState().auth?.self)
    if (!(await loggedIn())) {
      await page.getByText('Log in', { exact: true }).first().click()
      await page.locator('input[name="username"]').fill('claude-1')
      await page.locator('input[name="password"]').fill('shieldbattery')
      await page.keyboard.press('Enter')
      await page.waitForFunction(() => !!window.__sbReduxStore.getState().auth?.self, null, {
        timeout: 60000,
      })
    }
    await page.evaluate(async p => {
      const m = await import('http://localhost:5566/client/replays/action-creators.ts')
      window.__sbReduxStore.dispatch(m.startReplay({ path: p, name: 'rollback-soak' }))
    }, replayPath)
  } finally {
    await browser.close()
  }
}

// Runs the replay once with `env` and returns { outcome, done?, pid?, seconds, detail? }.
// Runs the replay, retrying launches that failed for reasons outside the game (Electron never
// came up, the replay never started) rather than reporting them as soak failures.
async function runReplay(worker, arch, replay, env, timeoutSecs) {
  let run
  for (let attempt = 0; attempt < 3; attempt++) {
    run = await runReplayOnce(worker, arch, replay, env, timeoutSecs)
    // A game that exits before its first logic step (SC:R occasionally quits during its own
    // startup with several instances launching) never ran anything under test.
    if (run.outcome === 'crash' && run.pid && !simulatedAnyFrame(run.pid)) {
      for (const f of csvForPid(run.pid)) fs.rmSync(f, { force: true })
      run = { ...run, outcome: 'error', detail: 'game exited before simulating a frame' }
    }
    if (run.outcome !== 'error') return run
    log(`w${worker} launch error (${run.detail}); retrying`)
    await sleep(10000)
  }
  return run
}

async function runReplayOnce(worker, arch, replay, env, timeoutSecs) {
  const session = `soak-${worker}`
  const port = 9300 + worker
  writeSessionSettings(session, arch)
  const donePath = path.join(SOAK, 'runs', `${session}-${Date.now()}.done.json`)
  const childEnv = { ...process.env }
  delete childEnv.ELECTRON_RUN_AS_NODE
  Object.assign(childEnv, {
    SB_HOT: '1',
    // Open the app and game behind whatever someone is doing on the machine, without focus.
    SB_APP_BACKGROUND: '1',
    SB_GAME_BACKGROUND: '1',
    SB_SESSION: session,
    SB_GAME_DLL_DIR: DLL_DIR,
    SB_ROLLBACK_SOAK: donePath,
    ...EXTRA_ENV,
    ...env,
  })
  const electron = spawn(
    path.join(ROOT, 'node_modules/electron/dist/electron.exe'),
    ['app', `--remote-debugging-port=${port}`, '--hidden'],
    { cwd: ROOT, env: childEnv, stdio: 'ignore', windowsHide: false },
  )
  // The run's Electron and game pids (`electron <pid>` / `game <pid>`) while it's in flight, so
  // clean-stop.sh can kill and clean up after exactly a killed runner's runs. Removed once the run
  // ends, since a recorded pid could otherwise belong to an unrelated process later.
  const pidsFile = path.join(SOAK, 'runs', `${session}.pids`)
  fs.writeFileSync(pidsFile, `electron ${electron.pid}
`)
  const started = Date.now()
  let gamePid = null
  try {
    let up = false
    for (let i = 0; i < 90 && !up; i++) {
      await sleep(1000)
      up = await fetch(`http://localhost:${port}/json/version`)
        .then(r => r.ok)
        .catch(() => false)
    }
    if (!up) return { outcome: 'error', detail: 'electron CDP never came up' }
    await startReplay(port, replay.path)
    const launchDeadline = Date.now() + 120000
    while (!gamePid) {
      gamePid = gamePidFor(session, donePath)
      if (gamePid) {
        fs.appendFileSync(pidsFile, `game ${gamePid}
`)
        break
      }
      if (Date.now() > launchDeadline)
        return { outcome: 'error', detail: 'game never started' }
      else await sleep(1000)
    }
    const deadline = Date.now() + timeoutSecs * 1000
    while (true) {
      if (fs.existsSync(donePath)) {
        const done = JSON.parse(fs.readFileSync(donePath, 'utf8'))
        fs.rmSync(donePath)
        return { outcome: 'done', done, pid: gamePid, seconds: (Date.now() - started) / 1000 }
      }
      if (!pidAlive(gamePid)) {
        await sleep(2000)
        if (fs.existsSync(donePath)) continue
        return {
          outcome: 'crash',
          pid: gamePid,
          seconds: (Date.now() - started) / 1000,
          detail: gameLogTail(session),
        }
      }
      if (Date.now() > deadline) {
        const detail = gameLogTail(session)
        killTree(gamePid)
        return { outcome: 'timeout', pid: gamePid, seconds: (Date.now() - started) / 1000, detail }
      }
      await sleep(2000)
    }
  } finally {
    if (gamePid && pidAlive(gamePid)) killTree(gamePid)
    killTree(electron.pid)
    fs.rmSync(pidsFile, { force: true })
  }
}

// ---- Fingerprints ----

const FINGERPRINT_COLUMNS = [
  'rng0',
  'rng1',
  'rng2',
  'rng3',
  'rng4',
  'rng5',
  'minerals0',
  'minerals1',
  'minerals2',
  'minerals3',
  'gas0',
  'gas1',
  'gas2',
  'gas3',
  'trigger_timer',
  'elapsed_seconds',
  'player_types',
  'state_hash',
]

async function* csvRows(file) {
  const rl = readline.createInterface({ input: fs.createReadStream(file) })
  let header = null
  for await (const line of rl) {
    const cols = line.split(',')
    if (!header) {
      header = cols
      continue
    }
    // The probe interleaves allocation dumps into its file; only fingerprint rows parse.
    if (cols.length < header.length - 1 || !/^\d+$/.test(cols[0])) continue
    yield Object.fromEntries(header.map((h, i) => [h, cols[i]]))
  }
}

export async function loadBaseline(probeCsv) {
  const frames = new Map()
  for await (const row of csvRows(probeCsv)) {
    frames.set(Number(row.frame), FINGERPRINT_COLUMNS.map(c => row[c]).join(','))
  }
  return frames
}

// Compares the harness's confirmed fingerprints against the baseline. Returns the first frame
// whose fingerprint differs (and which columns), plus coverage.
//
// Rows after the present first reaches the replay's last frame are skipped: BW stops stepping a
// replay that has ended and keeps that outside the snapshot, so later ticks that roll back can't
// step forward again and their fingerprints don't describe anything a live game would do.
export async function compareHarness(harnessCsv, baseline, plainEnd) {
  let compared = 0
  let lastConfirmed = 0
  let missing = 0
  let maxRollback = 0
  let endReached = false
  for await (const row of csvRows(harnessCsv)) {
    if (endReached) break
    if (Number(row.frame) >= plainEnd) endReached = true
    const frame = Number(row.confirmed_frame)
    maxRollback = Math.max(maxRollback, Number(row.rollback_frames) || 0)
    const expected = baseline.get(frame)
    if (expected === undefined) {
      missing++
      continue
    }
    const actual = FINGERPRINT_COLUMNS.map(c => row['c_' + c]).join(',')
    compared++
    lastConfirmed = Math.max(lastConfirmed, frame)
    if (actual !== expected) {
      const exp = expected.split(',')
      const act = actual.split(',')
      const columns = FINGERPRINT_COLUMNS.filter((_, i) => exp[i] !== act[i])
      return { mismatchFrame: frame, columns, compared, lastConfirmed, missing, maxRollback }
    }
  }
  return { mismatchFrame: null, compared, lastConfirmed, missing, maxRollback }
}

// ---- Configs ----

function randomConfig(game, arch) {
  const env = {}
  const desc = {}
  const players = Math.max(2, game.players)
  // Delays for a random subset of the first `players` storm ids (players occupy the low ids in
  // matchmaking and most lobbies; an id with no commands just adds nothing).
  const delays = []
  const delayedCount = rand(Math.min(players, 4) + 1) // 0..min(players,4)
  const ids = [...Array(players).keys()].sort(() => Math.random() - 0.5).slice(0, delayedCount)
  for (const id of ids) delays.push(`${id}:${1 + rand(8)}`)
  let depth = pick([0, 1, 1, 2, 2, 3, 4, 6, 8])
  if (depth === 0 && delays.length === 0) depth = 1 + rand(4)
  env.SB_ROLLBACK_HARNESS = String(depth)
  desc.depth = depth
  if (delays.length) {
    env.SB_ROLLBACK_DELAY = delays.join(',')
    desc.delays = env.SB_ROLLBACK_DELAY
  }
  const spacing = pick([1, 2, 3, 3, 3, 4])
  env.SB_ROLLBACK_SNAPSHOT_SPACING = String(spacing)
  desc.spacing = spacing
  if (Math.random() < 0.6) {
    // Vision is only applied once playback reaches SB_ROLLBACK_HARNESS_FROM.
    const viewer = rand(players)
    env.SB_ROLLBACK_HARNESS_VISION = String(1 << viewer)
    env.SB_ROLLBACK_HARNESS_FROM = '1'
    desc.vision = viewer
  }
  desc.arch = arch
  return { env, desc }
}

function fixedConfig() {
  // `;` stands in for `,` inside values (SB_ROLLBACK_DELAY=0:2;3:6).
  const env = Object.fromEntries(
    FIXED_ENV.split(',').map(x => x.split('=')).map(([k, v]) => [k, v.replaceAll(';', ',')]),
  )
  return { env, desc: { fixed: FIXED_ENV, depth: Number(env.SB_ROLLBACK_HARNESS ?? 0), arch: FIXED_ARCH } }
}

// ---- Failure capture ----

function csvForPid(pid) {
  return fs
    .readdirSync(LOGS)
    .filter(f => /^rollback-(harness|probe)-/.test(f) && f.endsWith(`-${pid}.csv`))
    .map(f => path.join(LOGS, f))
}

// Whether the run's fingerprint files have any rows past their header.
function simulatedAnyFrame(pid) {
  return csvForPid(pid).some(f => fs.readFileSync(f, 'latin1').split(String.fromCharCode(10), 3).length > 2)
}

function captureFailure(game, replay, label, run, extra) {
  const dir = path.join(SOAK, 'failures', `${game.id}-${label}-${Date.now()}`)
  fs.mkdirSync(dir, { recursive: true })
  fs.copyFileSync(replay.path, path.join(dir, 'replay.rep'))
  fs.writeFileSync(
    path.join(dir, 'info.json'),
    JSON.stringify({ game, replay, label, ...run, ...extra }, null, 2),
  )
  if (run.detail) fs.writeFileSync(path.join(dir, 'game-log-tail.txt'), run.detail)
  if (run.pid) {
    for (const f of csvForPid(run.pid)) fs.renameSync(f, path.join(dir, path.basename(f)))
  }
  const dump = path.join(LOGS, 'latest_crash.dmp')
  if (run.outcome === 'crash' && fs.existsSync(dump)) {
    const age = Date.now() - fs.statSync(dump).mtimeMs
    if (age < 5 * 60 * 1000) fs.copyFileSync(dump, path.join(dir, 'latest_crash.dmp'))
  }
  return dir
}

function removeCsvs(run) {
  if (run.done) {
    for (const f of [run.done.harness_csv, run.done.probe_csv]) if (f) fs.rmSync(f, { force: true })
  }
  if (run.pid) for (const f of csvForPid(run.pid)) fs.rmSync(f, { force: true })
}

// ---- Main loop ----

async function waitWhilePaused() {
  while (fs.existsSync(BENCH_LOCK)) {
    log('bench lock held; waiting')
    await sleep(30000)
  }
}

function timeoutFor(replay, multiplier) {
  // Generous: at least 25 game frames per wall second, times the rollback cost, plus startup.
  return 180 + Math.ceil((replay.frames / 25) * multiplier)
}

async function soakGame(worker, game) {
  let replay
  try {
    replay = await fetchReplay(game.id)
  } catch (e) {
    appendResult({ kind: 'game', game: game.id, outcome: 'skipped', detail: String(e) })
    return
  }
  await waitWhilePaused()
  const PLAIN_ARCH = PLAIN_ARCH_OPT ?? (FIXED_ENV ? FIXED_ARCH : Math.random() < 0.3 ? 'x86' : 'x64')
  let plain
  if (BASELINE) {
    let frame = 0
    for await (const row of csvRows(BASELINE)) frame = Math.max(frame, Number(row.frame))
    plain = { outcome: 'done', done: { frame, probe_csv: BASELINE } }
  } else {
    log(`w${worker} ${game.id} ${game.src}/${game.typ} ${replay.frames}f: plain ${PLAIN_ARCH}`)
    plain = await runReplay(
      worker,
      PLAIN_ARCH,
      replay,
      { SB_ROLLBACK_PROBE: '1' },
      timeoutFor(replay, 1),
    )
  }
  appendResult({
    kind: 'run',
    game: game.id,
    label: 'plain',
    arch: PLAIN_ARCH,
    outcome: plain.outcome,
    frames: plain.done?.frame,
    seconds: plain.seconds,
  })
  if (plain.outcome !== 'done' || !plain.done.probe_csv) {
    const dir = captureFailure(game, replay, 'plain', plain, {})
    log(`w${worker} ${game.id} PLAIN ${plain.outcome} -> ${dir}`)
    appendResult({ kind: 'game', game: game.id, outcome: `plain-${plain.outcome}`, dir })
    return
  }
  const baseline = await loadBaseline(plain.done.probe_csv)
  const plainEnd = plain.done.frame
  let failures = 0
  for (let i = 0; i < CONFIGS; i++) {
    await waitWhilePaused()
    if (fs.existsSync(STOP_FILE)) break
    const { env, desc } = FIXED_ENV ? fixedConfig() : randomConfig(game, PLAIN_ARCH)
    if (!FIXED_ENV && KNOWN_HOLES[desc.arch]) {
      env.SB_ROLLBACK_EXTRA_RANGES = KNOWN_HOLES[desc.arch]
    }
    const label = `c${i}`
    log(`w${worker} ${game.id} ${label} ${JSON.stringify(desc)}`)
    const run = await runReplay(
      worker,
      desc.arch,
      replay,
      env,
      timeoutFor(replay, 2 + Number(desc.depth) / 2),
    )
    let cmp = null
    let outcome = run.outcome
    if (run.outcome === 'done') {
      if (!run.done.harness_csv) {
        outcome = 'no-harness-csv'
      } else {
        // A run told to stop early (SB_ROLLBACK_SOAK_UNTIL) is judged up to where it stopped.
        const until = Number(env.SB_ROLLBACK_SOAK_UNTIL ?? EXTRA_ENV.SB_ROLLBACK_SOAK_UNTIL)
        const end = until > 0 ? Math.min(plainEnd, until) : plainEnd
        cmp = await compareHarness(run.done.harness_csv, baseline, end)
        // Delayed commands that only arrive once the replay has ended roll the game back to
        // frames BW then won't step past, so the final frame can sit up to the delay short of
        // the plain run's; what has to hold is that every confirmed frame matched and that the
        // confirmed frames reached the end.
        if (cmp.mismatchFrame !== null) outcome = 'mismatch'
        else if (cmp.lastConfirmed < end - 24) outcome = 'short-of-end'
        else if (!(until > 0) && cmp.compared < plainEnd * 0.9) outcome = 'low-coverage'
        else outcome = 'pass'
      }
    }
    const result = {
      kind: 'run',
      game: game.id,
      label,
      ...desc,
      env,
      outcome,
      frames: run.done?.frame,
      plainEnd,
      seconds: run.seconds,
      ...(cmp ?? {}),
    }
    if (outcome !== 'pass') {
      failures++
      result.dir = captureFailure(game, replay, label, run, { env, desc, cmp, plainEnd })
      // The harness CSV moved into the failure dir already (it's named by pid).
      log(`w${worker} ${game.id} ${label} FAIL ${outcome} -> ${result.dir}`)
    } else {
      removeCsvs(run)
      log(`w${worker} ${game.id} ${label} pass (${Math.round(run.seconds)}s)`)
    }
    appendResult(result)
  }
  if (failures) {
    // Keep the baseline next to the failures it explains.
    const dir = path.join(SOAK, 'failures', `${game.id}-baseline`)
    fs.mkdirSync(dir, { recursive: true })
    if (!BASELINE) {
      fs.renameSync(plain.done.probe_csv, path.join(dir, path.basename(plain.done.probe_csv)))
    }
  } else {
    if (!BASELINE) removeCsvs(plain)
    fs.rmSync(replay.path, { force: true })
  }
  appendResult({ kind: 'game', game: game.id, outcome: failures ? 'failed' : 'pass', failures })
}

async function main() {
  fs.mkdirSync(path.join(SOAK, 'runs'), { recursive: true })
  fs.mkdirSync(path.join(SOAK, 'replays'), { recursive: true })
  fs.mkdirSync(path.join(SOAK, 'failures'), { recursive: true })
  const queue = loadQueue().slice(0, MAX_GAMES)
  log(`${queue.length} games queued, ${WORKERS} workers, ${CONFIGS} configs each`)
  let next = 0
  await Promise.all(
    [...Array(WORKERS).keys()].map(async w => {
      // Stagger Electron startups.
      await sleep(w * 15000)
      while (next < queue.length && !fs.existsSync(STOP_FILE)) {
        const game = queue[next++]
        try {
          await soakGame(WORKER_BASE + w + 1, game)
        } catch (e) {
          log(`w${w + 1} ${game.id} runner error: ${e.stack}`)
          appendResult({ kind: 'game', game: game.id, outcome: 'runner-error', detail: e.stack })
        }
      }
    }),
  )
  log('soak finished')
}

// Importing the module (to reuse the comparison, say) must not start a soak.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
