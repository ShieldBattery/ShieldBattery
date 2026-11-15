// Windows process, port and config helpers shared by dev-stack.mjs and verify-app/sb-app.mjs.
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'

/** The checkout (main tree or worktree) this file lives in: <root>/.claude/skills/dev-env/. */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

// Fixed under %LOCALAPPDATA%\Temp rather than os.tmpdir(), so a session whose TMP points somewhere
// else still finds the processes an earlier session started. Ports are machine-wide, so this state
// is too: one dev stack per machine, whichever checkout started it.
export const STATE_DIR = path.join(
  process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Temp') : os.tmpdir(),
  'shieldbattery-dev',
)

export const sleep = ms => new Promise(r => setTimeout(r, ms))

export function git(args, opts = {}) {
  const r = spawnSync('git', ['-C', ROOT, ...args], { encoding: 'utf8', ...opts })
  return r.status === 0 ? r.stdout.trim() : null
}

/**
 * The main checkout, which differs from ROOT inside a worktree. `.env` is untracked, so a worktree
 * usually lacks one and borrows the main checkout's.
 */
export function mainCheckout() {
  const common = git(['rev-parse', '--path-format=absolute', '--git-common-dir'])
  return common ? path.dirname(path.resolve(common)) : ROOT
}

/** The `.env` settings this checkout runs with, and the file they came from. */
export function loadEnv() {
  for (const dir of [ROOT, mainCheckout()]) {
    const file = path.join(dir, '.env')
    if (fs.existsSync(file)) {
      return { vars: parseEnv(fs.readFileSync(file, 'utf8')), file, borrowed: dir !== ROOT }
    }
  }
  return { vars: {}, file: null, borrowed: false }
}

export function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2))
  fs.renameSync(tmp, file)
}

/** Listening TCP sockets as a Map of port -> owning pids (IPv4 and IPv6 combined). */
export function listeners() {
  const out = execFileSync('netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf8' })
  const out6 = execFileSync('netstat', ['-ano', '-p', 'TCPv6'], { encoding: 'utf8' })
  const map = new Map()
  for (const line of (out + '\n' + out6).split(/\r?\n/)) {
    const m = line.trim().match(/^TCP\s+(\S+):(\d+)\s+\S+\s+LISTENING\s+(\d+)$/)
    if (!m) continue
    const port = Number(m[2])
    const pid = Number(m[3])
    if (!map.has(port)) map.set(port, new Set())
    map.get(port).add(pid)
  }
  return map
}

export function portOwner(port, ls = listeners()) {
  const pids = ls.get(port)
  return pids ? [...pids][0] : null
}

/**
 * Every process as a Map of pid -> { pid, ppid, name, start (ms since epoch), cmd }. Start times
 * tell a live process from a later one that reused its pid.
 */
export function processTable() {
  const script =
    'Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{ ' +
    'pid=$_.ProcessId; ppid=$_.ParentProcessId; name=$_.Name; ' +
    "start=if ($_.CreationDate) { $_.CreationDate.ToUniversalTime().ToString('o') } else { $null }; " +
    'cmd=$_.CommandLine } } | ConvertTo-Json -Compress'
  const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  const map = new Map()
  for (const p of JSON.parse(out)) {
    map.set(p.pid, { ...p, start: p.start ? Date.parse(p.start) : null })
  }
  return map
}

/** Whether `pid` is still the process that started at `start` (ms), not a reused pid. */
export function sameProcess(table, pid, start) {
  const p = table.get(pid)
  return !!p && p.start !== null && Math.abs(p.start - start) < 2000
}

export function isDescendant(table, pid, ancestor) {
  const seen = new Set()
  let cur = table.get(pid)
  while (cur && !seen.has(cur.pid)) {
    if (cur.ppid === ancestor) return true
    seen.add(cur.pid)
    const parent = table.get(cur.ppid)
    // A parent that started after its child is an unrelated process that reused the parent's pid.
    if (!parent || (parent.start && cur.start && parent.start > cur.start)) return false
    cur = parent
  }
  return false
}

export function descendants(table, pid) {
  return [...table.values()].filter(p => isDescendant(table, p.pid, pid))
}

export function pidAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return e.code === 'EPERM'
  }
}

/** Kills `pid` and everything under it. Returns whether taskkill reported success. */
export function killTree(pid) {
  const r = spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { encoding: 'utf8' })
  return r.status === 0
}

/** Resolves to the HTTP status, or to `{ error }` when nothing answered in time. */
export async function httpProbe(url, timeoutMs = 5000) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'manual' })
    await res.arrayBuffer().catch(() => {})
    return { status: res.status }
  } catch (e) {
    return { error: e.cause?.code ?? e.name ?? String(e) }
  }
}

export async function waitForPortFree(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!listeners().has(port)) return true
    await sleep(500)
  }
  return !listeners().has(port)
}

export function fmtTime(ms) {
  if (!ms) return '?'
  const d = new Date(ms)
  const pad = n => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  )
}

export function fmtDuration(ms) {
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
}

/**
 * Why a process that started at `start` may be running older code than this checkout holds: a
 * commit touching `paths` made after it started, or uncommitted edits under `paths` saved after it
 * started. Test files are left out, since no server loads them.
 */
export function staleReasons(paths, start) {
  const reasons = []
  const spec = [
    '--',
    ...paths,
    ':(exclude,glob)**/*.test.ts',
    ':(exclude,glob)**/*.test.tsx',
    ':(exclude,glob)**/*.md',
  ]
  const last = git(['log', '-1', '--format=%h%x09%ct%x09%s', ...spec])
  if (last) {
    const [hash, ct, subject] = last.split('\t')
    if (Number(ct) * 1000 > start) {
      reasons.push(`commit ${hash} (${fmtTime(Number(ct) * 1000)}) "${subject}" is newer`)
    }
  }
  const dirty = git(['status', '--porcelain', '-uall', ...spec])
  if (dirty) {
    const newer = []
    for (const line of dirty.split('\n')) {
      const file = line.slice(3).split(' -> ').pop().replace(/^"|"$/g, '')
      // A deleted file has nothing to stat and can't be newer.
      const mtime = fs.statSync(path.join(ROOT, file), { throwIfNoEntry: false })?.mtimeMs
      if (mtime > start) newer.push(file)
    }
    if (newer.length) {
      const more = newer.length > 3 ? ` and ${newer.length - 3} more` : ''
      reasons.push(
        `uncommitted edits saved after it started: ${newer.slice(0, 3).join(', ')}${more}`,
      )
    }
  }
  return reasons
}

/**
 * Fetches the renderer's module graph from its entry the way the app will, so Vite has transformed
 * every module and finished pre-bundling dependencies before a window loads. A dependency Vite
 * only discovers mid-load makes it re-optimize and answer 504 "Outdated Optimize Dep", which leaves
 * a freshly launched app blank; a crawl that saw 504s runs again until one completes without any.
 */
export async function warmRenderer(base, deadline, log = console.log) {
  for (let pass = 1; pass <= 4; pass++) {
    const started = Date.now()
    const seen = new Set()
    const queue = ['/app/index.html', '/client/index.jsx']
    let outdated = 0
    let failed = 0
    const worker = async () => {
      while (queue.length && Date.now() < deadline) {
        const url = queue.shift()
        let res, text
        try {
          res = await fetch(base + url, {
            signal: AbortSignal.timeout(Math.max(1000, Math.min(180000, deadline - Date.now()))),
          })
          text = await res.text()
        } catch {
          failed++
          continue
        }
        if (res.status === 504) {
          outdated++
          continue
        }
        if (!res.ok) continue
        const type = res.headers.get('content-type') ?? ''
        if (!/javascript|html/.test(type)) continue
        const re =
          /(?:\bimport|\bexport)\s*(?:[\w*{}\s,$]+?\s*from\s*)?["']([^"'\n]+)["']|\bimport\(\s*["']([^"'\n]+)["']\s*\)|<script[^>]+src=["']([^"']+)["']/g
        for (const m of text.matchAll(re)) {
          const spec = m[1] ?? m[2] ?? m[3]
          let u
          try {
            u = new URL(spec, base + url)
          } catch {
            continue
          }
          if (u.origin !== base) continue
          const key = u.pathname + u.search
          if (!seen.has(key) && seen.size < 20000) {
            seen.add(key)
            queue.push(key)
          }
        }
      }
    }
    // Workers exit when the queue is momentarily empty while others still fetch; rerun until the
    // queue stays drained.
    while (queue.length && Date.now() < deadline) {
      await Promise.all(Array.from({ length: 16 }, worker))
    }
    if (Date.now() >= deadline) throw new Error('renderer warm-up timed out')
    log(
      `renderer: warmed ${seen.size} modules in ${fmtDuration(Date.now() - started)}` +
        (outdated ? `, ${outdated} answered 504 (deps re-optimized); warming again` : '') +
        (failed ? `, ${failed} failed` : ''),
    )
    if (!outdated) return
    await sleep(3000)
  }
  throw new Error('renderer kept re-optimizing dependencies')
}
