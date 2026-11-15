#!/usr/bin/env node
// Starts, stops and reports on the ShieldBattery dev services (Node server, Rust server, renderer
// dev server) as detached processes whose pids are kept in STATE_DIR, so any later session can
// stop exactly what this script started and tell it apart from someone else's servers.
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import {
  fmtDuration,
  fmtTime,
  httpProbe,
  isDescendant,
  killTree,
  listeners,
  loadEnv,
  mainCheckout,
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
} from './stack-common.mjs'

const HELP = `usage: node .claude/skills/dev-env/dev-stack.mjs <command> [args]

commands:
  status [--json]                 each service's listener, pid, start time, owner (dev-stack or
                                  external), HTTP health and staleness; Docker; pending migrations
  start [node] [rust] [renderer]  default: node rust. Starts Docker containers if stopped, applies
        [--timeout <s>]           pending migrations, then starts each service whose port is free
                                  and waits until it is healthy (renderer: Vite pre-bundled and
                                  module graph warmed). A port that already has a listener is left
                                  alone. First Rust compile can take 10+ minutes: run long starts
                                  in the background.
  stop [services...] [--force]    default: every service dev-stack started. Kills their process
                                  trees and checks the ports are free. An external listener is only
                                  killed with --force, and its pid + command line are printed.
  restart <services...> [--force] stop, then start
  warm [--timeout <s>]            crawl the renderer's module graph (ours or external) so a new
                                  app window doesn't come up blank; part of \`start renderer\`
  logs <service> [-n N] [--raw]   last N (default 60) lines of a service's log, pino/bunyan JSON
                                  formatted unless --raw

services: node (:SB_HTTP_PORT, 5555), rust (:SB_GQL_PORT, 5556), renderer (:5566)
state + logs: ${STATE_DIR}
exit codes: 0 ok; 1 failure; 2 stop left an external listener running (no --force)`

const STATE_FILE = path.join(STATE_DIR, 'dev-stack.json')
const LOG_DIR = path.join(STATE_DIR, 'logs')
const DB_CONTAINER = 'shieldbattery-db-1'
const REDIS_CONTAINER = 'shieldbattery-redis-1'

const env = loadEnv()
const E = env.vars

const SERVICES = {
  node: {
    port: Number(E.SB_HTTP_PORT || 5555),
    host: 'localhost',
    cwd: ROOT,
    cmd: process.execPath,
    args: ['--trace-warnings', '-r', '@swc-node/register', './server/app.ts'],
    healthPath: '/',
    stalePaths: ['server', 'common', 'package.json', 'pnpm-lock.yaml'],
    timeoutSecs: 300,
  },
  rust: {
    port: Number(E.SB_GQL_PORT || 5556),
    host: E.SB_GQL_HOST || '127.0.0.1',
    cwd: path.join(ROOT, 'server-rs'),
    cmd: 'cargo',
    args: ['run'],
    // Any response means the server is up; it answers 404 on `/`.
    healthPath: '/',
    stalePaths: ['server-rs/src', 'server-rs/Cargo.toml', 'server-rs/Cargo.lock'],
    timeoutSecs: 1800,
  },
  renderer: {
    // Fixed in vite.electron.config.ts and app/app.ts, not configurable through .env.
    port: 5566,
    host: 'localhost',
    cwd: ROOT,
    cmd: process.execPath,
    args: [path.join(ROOT, 'node_modules/vite/bin/vite.js'), '-c', 'vite.electron.config.ts'],
    healthPath: '/app/index.html',
    // Vite serves source live; only its config and dependencies need a restart.
    stalePaths: [
      'vite.electron.config.ts',
      'vite.shared.ts',
      'build-plugins',
      'package.json',
      'pnpm-lock.yaml',
    ],
    timeoutSecs: 900,
  },
}
const ALL = Object.keys(SERVICES)

const log = (...a) => console.log(...a)
const loadState = () => readJson(STATE_FILE, { services: {} })
const saveState = s => writeJson(STATE_FILE, s)

function serviceEnv() {
  const childEnv = { ...process.env }
  delete childEnv.ELECTRON_RUN_AS_NODE
  // The servers load `.env` from their working directory, which a worktree usually lacks; the
  // variables are passed down instead, and neither server overrides what the environment sets.
  if (env.borrowed) Object.assign(childEnv, E, { ...process.env })
  return childEnv
}

// ---- Classification ----

/**
 * Who owns a service's port: `{ listening, owner, ours, entry }`. A listener is ours when it is the
 * process dev-stack spawned (same pid and start time), one of its descendants (cargo's server.exe),
 * or the recorded listener itself after its spawner exited.
 */
function classify(name, table, ls) {
  const svc = SERVICES[name]
  const entry = loadState().services[name]
  const ownerPid = portOwner(svc.port, ls)
  const owner = ownerPid ? (table.get(ownerPid) ?? { pid: ownerPid }) : null
  const entryAlive = entry && sameProcess(table, entry.pid, entry.start)
  let ours = false
  if (owner && entry) {
    ours =
      (entryAlive && (owner.pid === entry.pid || isDescendant(table, owner.pid, entry.pid))) ||
      (entry.listener &&
        sameProcess(table, entry.listener.pid, entry.listener.start) &&
        owner.pid === entry.listener.pid)
  }
  return { name, svc, listening: !!owner, owner, ours, entry, entryAlive }
}

async function health(svc) {
  return httpProbe(`http://${svc.host}:${svc.port}${svc.healthPath}`, 10000)
}

// ---- Docker and migrations ----

function docker(args, opts = {}) {
  return spawnSync('docker', args, { encoding: 'utf8', ...opts })
}

function containerStates() {
  const r = docker(['ps', '-a', '--format', '{{.Names}}\t{{.State}}\t{{.Status}}'])
  if (r.status !== 0) return { error: (r.stderr || r.error?.message || 'docker failed').trim() }
  const states = {}
  for (const line of r.stdout.trim().split('\n')) {
    const [n, state, status] = line.split('\t')
    if (n === DB_CONTAINER || n === REDIS_CONTAINER) states[n] = { state, status }
  }
  return states
}

function migrationStatus() {
  const dir = path.join(ROOT, 'migrations')
  let files
  try {
    files = fs
      .readdirSync(dir)
      .filter(f => /^\d+_.*\.sql$/.test(f))
      .map(f => f.split('_')[0])
  } catch {
    return { error: 'no migrations directory' }
  }
  const r = docker([
    'exec',
    DB_CONTAINER,
    'psql',
    '-U',
    E.SB_DB_USER || 'shieldbattery',
    '-d',
    E.SB_DB || 'shieldbattery',
    '-tAc',
    'select version from _sqlx_migrations where success',
  ])
  if (r.status !== 0) return { error: (r.stderr || 'psql failed').trim().split('\n')[0] }
  const applied = new Set(r.stdout.trim().split(/\s+/).filter(Boolean))
  const pending = files.filter(v => !applied.has(v))
  return { applied: applied.size, pending }
}

async function ensureDocker() {
  let states = containerStates()
  if (states.error) throw new Error(`Docker is not usable: ${states.error}`)
  const missing = [DB_CONTAINER, REDIS_CONTAINER].filter(n => !states[n])
  if (missing.length) {
    // The compose project name is pinned: run from a worktree, compose would otherwise name a
    // second, empty set of containers after the worktree's directory.
    log(`docker: ${missing.join(', ')} missing; creating with docker compose`)
    const r = docker(['compose', '-p', 'shieldbattery', 'up', '-d', 'db', 'redis'], {
      cwd: mainCheckout(),
      stdio: 'inherit',
    })
    if (r.status !== 0) throw new Error('docker compose up failed')
  }
  states = containerStates()
  const stopped = [DB_CONTAINER, REDIS_CONTAINER].filter(n => states[n]?.state !== 'running')
  if (stopped.length) {
    log(`docker: starting ${stopped.join(', ')}`)
    const r = docker(['start', ...stopped], { stdio: 'inherit' })
    if (r.status !== 0) throw new Error('docker start failed')
  }
  for (let i = 0; i < 60; i++) {
    const r = docker(['exec', DB_CONTAINER, 'pg_isready', '-U', E.SB_DB_USER || 'shieldbattery'])
    if (r.status === 0) return
    await sleep(1000)
  }
  throw new Error('Postgres did not become ready within 60s')
}

function runMigrations() {
  const st = migrationStatus()
  if (!st.error && st.pending.length === 0) {
    log(`db: ${st.applied} migrations applied, none pending`)
    return
  }
  log(
    st.error
      ? `db: can't read migration state (${st.error}); running migrations`
      : `db: applying ${st.pending.length} pending migration(s)`,
  )
  // `pnpm run migrate:run` is this same command; calling cargo directly skips pnpm's output.
  const r = spawnSync('cargo', ['sqlx', 'migrate', 'run'], {
    cwd: ROOT,
    env: serviceEnv(),
    encoding: 'utf8',
  })
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim()
  if (out)
    log(
      out
        .split('\n')
        .map(l => `  ${l}`)
        .join('\n'),
    )
  if (r.status !== 0) throw new Error('migrations failed')
}

// ---- Status ----

async function status(json) {
  const table = processTable()
  const ls = listeners()
  const rows = []
  for (const name of ALL) {
    const c = classify(name, table, ls)
    const row = {
      service: name,
      port: c.svc.port,
      listening: c.listening,
      pid: c.owner?.pid ?? null,
      process: c.owner?.name ?? null,
      started: c.owner?.start ? new Date(c.owner.start).toISOString() : null,
      owner: null,
      commandLine: c.owner?.cmd ?? null,
      log: c.entry ? c.entry.log : null,
      startedFrom: c.ours ? c.entry.root : null,
      http: null,
      stale: [],
      note: null,
    }
    if (c.listening) {
      row.owner = c.ours ? 'dev-stack' : 'external'
      const h = await health(c.svc)
      row.http = h.status ?? `no answer (${h.error})`
      if (c.owner.start) row.stale = staleReasons(c.svc.stalePaths, c.owner.start)
      if (c.ours && path.resolve(c.entry.root) !== ROOT) {
        row.note = `started from another checkout: ${c.entry.root}`
      }
    } else if (c.entryAlive) {
      row.note = `dev-stack process ${c.entry.pid} is alive but not listening yet (starting or compiling)`
    }
    rows.push(row)
  }
  const docker = containerStates()
  const migrations = docker.error ? { error: 'docker unavailable' } : migrationStatus()
  if (json) {
    log(JSON.stringify({ services: rows, docker, migrations, stateDir: STATE_DIR }, null, 2))
    return 0
  }
  if (docker.error) {
    log(`docker    unavailable: ${docker.error}`)
  } else {
    log(
      'docker    ' +
        [DB_CONTAINER, REDIS_CONTAINER]
          .map(n => `${n}: ${docker[n] ? `${docker[n].state} (${docker[n].status})` : 'missing'}`)
          .join('   '),
    )
  }
  if (migrations.error) log(`db        migrations unknown: ${migrations.error}`)
  else {
    log(
      `db        ${migrations.applied} migrations applied, ${migrations.pending.length} pending` +
        (migrations.pending.length ? ` (${migrations.pending.join(', ')}): run \`start\`` : ''),
    )
  }
  for (const r of rows) {
    const head = `${r.service.padEnd(9)} :${r.port}`
    if (!r.listening) {
      log(`${head}  down${r.note ? `  (${r.note})` : ''}`)
      continue
    }
    log(
      `${head}  up  pid ${r.pid} ${r.process ?? '?'}  started ${fmtTime(Date.parse(r.started))}  ` +
        `${r.owner}  http ${r.http}`,
    )
    if (r.owner === 'external') log(`          cmd: ${r.commandLine ?? '?'}`)
    else log(`          log: ${r.log}`)
    if (r.note) log(`          note: ${r.note}`)
    for (const s of r.stale) log(`          WARNING stale: ${s}`)
  }
  if (env.borrowed) log(`(.env borrowed from ${env.file})`)
  return 0
}

// ---- Start ----

function lastLogLine(file) {
  try {
    const text = fs.readFileSync(file, 'utf8')
    const lines = text.split(/\r?\n/).filter(l => l.trim())
    return formatLine(lines.at(-1) ?? '').slice(0, 140)
  } catch {
    return ''
  }
}

function spawnService(name) {
  const svc = SERVICES[name]
  fs.mkdirSync(LOG_DIR, { recursive: true })
  const logFile = path.join(LOG_DIR, `${name}.log`)
  if (fs.existsSync(logFile)) fs.renameSync(logFile, path.join(LOG_DIR, `${name}.prev.log`))
  const fd = fs.openSync(logFile, 'w')
  // Detached with no shell or pnpm in between, so the pid is the service itself (or cargo for
  // rust), it outlives this script, and killing its tree takes everything down.
  const child = spawn(svc.cmd, svc.args, {
    cwd: svc.cwd,
    env: serviceEnv(),
    detached: true,
    stdio: ['ignore', fd, fd],
    windowsHide: true,
  })
  fs.closeSync(fd)
  if (!child.pid) throw new Error(`${name}: failed to spawn ${svc.cmd}`)
  child.unref()
  child.on('error', () => {})
  const table = processTable()
  const start = table.get(child.pid)?.start ?? Date.now()
  const state = loadState()
  state.services[name] = {
    pid: child.pid,
    start,
    root: ROOT,
    command: [svc.cmd, ...svc.args].join(' '),
    log: logFile,
    startedAt: new Date().toISOString(),
  }
  saveState(state)
  log(`${name}: started pid ${child.pid}, log ${logFile}`)
  return state.services[name]
}

async function waitHealthy(name, entry, timeoutSecs) {
  const svc = SERVICES[name]
  const began = Date.now()
  const deadline = began + timeoutSecs * 1000
  let nextProgress = began + 30000
  while (Date.now() < deadline) {
    if (!pidAlive(entry.pid)) {
      const table = processTable()
      const c = classify(name, table, listeners())
      if (!c.listening) {
        log(`${name}: process ${entry.pid} exited before becoming healthy. Log tail:`)
        log(tail(entry.log, 25))
        return false
      }
    }
    if (listeners().has(svc.port)) {
      const h = await health(svc)
      if (h.status) {
        // Remember the listener too: if its parent (cargo) dies, the listener stays ours.
        const table = processTable()
        const ownerPid = portOwner(svc.port)
        const owner = table.get(ownerPid)
        const state = loadState()
        if (state.services[name] && owner) {
          state.services[name].listener = { pid: owner.pid, start: owner.start, name: owner.name }
          saveState(state)
        }
        if (name === 'renderer') await warmRenderer(`http://${svc.host}:${svc.port}`, deadline)
        log(`${name}: healthy (http ${h.status}) after ${fmtDuration(Date.now() - began)}`)
        return true
      }
    }
    if (Date.now() >= nextProgress) {
      log(`${name}: still waiting (${fmtDuration(Date.now() - began)}): ${lastLogLine(entry.log)}`)
      nextProgress = Date.now() + 30000
    }
    await sleep(1000)
  }
  log(`${name}: not healthy after ${timeoutSecs}s; still running (pid ${entry.pid}). Log tail:`)
  log(tail(entry.log, 15))
  return false
}

async function start(names, timeoutOverride) {
  await ensureDocker()
  runMigrations()
  const table = processTable()
  const ls = listeners()
  const waits = []
  for (const name of names) {
    const c = classify(name, table, ls)
    const svc = SERVICES[name]
    if (c.listening) {
      log(
        `${name}: already running on :${svc.port} (${c.ours ? 'dev-stack' : 'external'}, pid ` +
          `${c.owner.pid} ${c.owner.name ?? ''}); left alone`,
      )
      if (name === 'renderer' && !c.ours) {
        const h = await health(svc)
        if (!h.status) log(`renderer: WARNING external renderer is not answering (${h.error})`)
      }
      continue
    }
    if (c.entryAlive) {
      log(`${name}: dev-stack process ${c.entry.pid} is still starting; waiting for it`)
      waits.push([name, c.entry])
      continue
    }
    waits.push([name, spawnService(name)])
  }
  const results = await Promise.all(
    waits.map(([name, entry]) =>
      waitHealthy(name, entry, timeoutOverride ?? SERVICES[name].timeoutSecs),
    ),
  )
  log('')
  await status(false)
  return results.every(Boolean) ? 0 : 1
}

// ---- Stop ----

async function stop(names, force, explicit) {
  const table = processTable()
  const ls = listeners()
  const state = loadState()
  let code = 0
  for (const name of names) {
    const c = classify(name, table, ls)
    const svc = SERVICES[name]
    const killed = []
    if (c.entry) {
      // Our spawned process and its recorded listener, whichever are still the same processes.
      for (const p of [c.entry, c.entry.listener].filter(Boolean)) {
        if (!killed.includes(p.pid) && sameProcess(table, p.pid, p.start)) {
          killTree(p.pid)
          killed.push(p.pid)
        }
      }
    }
    if (c.listening && !c.ours) {
      if (force) {
        const o = c.owner
        log(
          `${name}: --force: killing external listener pid ${o.pid} (${o.name ?? '?'}): ${o.cmd ?? '?'}`,
        )
        killTree(o.pid)
        killed.push(o.pid)
      } else {
        if (explicit) {
          log(
            `${name}: :${svc.port} is held by external pid ${c.owner.pid} (${c.owner.name ?? '?'}); ` +
              'not stopped (pass --force to kill it)',
          )
          code = Math.max(code, 2)
        }
        delete state.services[name]
        continue
      }
    }
    delete state.services[name]
    if (!killed.length && !c.listening) {
      if (explicit) log(`${name}: not running`)
      continue
    }
    const free = await waitForPortFree(svc.port, 15000)
    if (free) log(`${name}: stopped (killed ${killed.join(', ')}); :${svc.port} is free`)
    else {
      const still = portOwner(svc.port)
      log(
        `${name}: ERROR :${svc.port} still held by pid ${still} after killing ${killed.join(', ')}`,
      )
      code = 1
    }
  }
  saveState(state)
  return code
}

// ---- Logs ----

const LEVELS = { 10: 'TRACE', 20: 'DEBUG', 30: 'INFO', 40: 'WARN', 50: 'ERROR', 60: 'FATAL' }

function formatLine(line) {
  if (!line.startsWith('{')) return line
  let o
  try {
    o = JSON.parse(line)
  } catch {
    return line
  }
  const t = o.time ? new Date(o.time) : null
  const time = t && !isNaN(t) ? t.toTimeString().slice(0, 8) : ''
  const level = LEVELS[o.level] ?? String(o.level ?? '').toUpperCase()
  let out = `${time} ${level.padEnd(5)} ${o.msg ?? ''}`
  if (o.req?.method) out += ` ${o.req.method} ${o.req.url} -> ${o.res?.statusCode ?? ''}`
  if (o.err?.stack) out += `\n${o.err.stack}`
  else if (o.err?.message) out += ` (${o.err.message})`
  return out
}

function tail(file, n, raw = false) {
  let text
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    return `(no log at ${file})`
  }
  const lines = text.split(/\r?\n/).filter(l => l.length)
  return lines
    .slice(-n)
    .map(l => (raw ? l : formatLine(l)))
    .join('\n')
}

function logs(name, n, raw) {
  const entry = loadState().services[name]
  const file = entry?.log ?? path.join(LOG_DIR, `${name}.log`)
  if (!fs.existsSync(file)) {
    log(`${name}: no dev-stack log (${file}); an external ${name} logs wherever it was started`)
    return 1
  }
  log(`== ${file}`)
  log(tail(file, n, raw))
  return 0
}

// ---- CLI ----

async function main() {
  const argv = process.argv.slice(2)
  const cmd = argv[0]
  if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help') {
    log(HELP)
    return cmd ? 0 : 1
  }
  const flags = new Set(argv.filter(a => a.startsWith('--')))
  const optVal = (name, def) => {
    const i = argv.indexOf(name)
    return i >= 0 ? argv[i + 1] : def
  }
  const valueOpts = new Set(['--timeout', '-n'])
  const positional = argv
    .slice(1)
    .filter((a, i, arr) => !a.startsWith('-') && !valueOpts.has(arr[i - 1]))
  const bad = positional.filter(p => !ALL.includes(p))
  if (bad.length && cmd !== 'logs') {
    log(`unknown service(s): ${bad.join(', ')} (expected ${ALL.join(', ')})`)
    return 1
  }
  fs.mkdirSync(STATE_DIR, { recursive: true })
  switch (cmd) {
    case 'status':
      return status(flags.has('--json'))
    case 'start': {
      const t = optVal('--timeout')
      return start(positional.length ? positional : ['node', 'rust'], t ? Number(t) : undefined)
    }
    case 'stop': {
      const names = positional.length ? positional : Object.keys(loadState().services)
      if (!names.length) {
        log('nothing dev-stack started is recorded as running')
        return 0
      }
      return stop(names, flags.has('--force'), positional.length > 0)
    }
    case 'restart': {
      if (!positional.length) {
        log('restart needs at least one service')
        return 1
      }
      const code = await stop(positional, flags.has('--force'), true)
      if (code !== 0) return code
      const t = optVal('--timeout')
      return start(positional, t ? Number(t) : undefined)
    }
    case 'warm': {
      const svc = SERVICES.renderer
      if (!listeners().has(svc.port)) {
        log(`renderer: nothing is listening on :${svc.port}`)
        return 1
      }
      const t = Number(optVal('--timeout', 600))
      await warmRenderer(`http://${svc.host}:${svc.port}`, Date.now() + t * 1000)
      return 0
    }
    case 'logs': {
      if (positional.length !== 1 || !ALL.includes(positional[0])) {
        log(`logs needs one service: ${ALL.join(', ')}`)
        return 1
      }
      return logs(positional[0], Number(optVal('-n', 60)), flags.has('--raw'))
    }
    default:
      log(`unknown command: ${cmd}\n\n${HELP}`)
      return 1
  }
}

main().then(
  code => process.exit(code),
  err => {
    console.error(`error: ${err.message}`)
    process.exit(1)
  },
)
