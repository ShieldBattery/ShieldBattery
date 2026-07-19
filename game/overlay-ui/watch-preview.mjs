// Watch the overlay-ui sources and rebuild + relaunch the `overlay-preview` app on every save, so
// editing the overlay render code feels like hot reload without launching StarCraft. This is the
// tier-2 dev-mode step from docs/netcode-v2.md ("Overlay UI dev mode"): a plain crate rebuild +
// process swap. (True in-process reload via hot-lib-reloader is a separate, later step.)
//
// Run from anywhere:  node game/overlay-ui/watch-preview.mjs [-- <extra overlay-preview args>]
//                 or:  pnpm run overlay-preview:watch
//
// Anything after a literal `--` is forwarded to the launched app (e.g. `-- --backdrop shot.png`).
// No external tooling (cargo-watch/watchexec) required — only Node + cargo.

import { spawn } from 'node:child_process'
import { watch } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const crateDir = dirname(fileURLToPath(import.meta.url))
const srcDir = join(crateDir, 'src')
const manifest = join(crateDir, 'Cargo.toml')

// Forward everything after a `--` separator to the preview binary.
const sepIndex = process.argv.indexOf('--')
const appArgs = sepIndex === -1 ? [] : process.argv.slice(sepIndex + 1)

const DEBOUNCE_MS = 200

/** @type {import('node:child_process').ChildProcess | null} */
let child = null
let building = false
// A change that arrived while a build was already running; triggers exactly one follow-up build.
let rebuildQueued = false
let debounceTimer = null

function log(msg) {
  // eslint-disable-next-line no-console
  console.log(`[overlay-preview:watch] ${msg}`)
}

function killChild() {
  if (child && child.exitCode === null && child.signalCode === null) {
    child.removeAllListeners('exit')
    child.kill()
  }
  child = null
}

function launch(exePath) {
  killChild()
  child = spawn(exePath, appArgs, { stdio: 'inherit' })
  child.on('exit', (code, signal) => {
    // Only surface an unexpected exit; a rebuild kills the child itself (listeners removed first).
    if (child && signal === null) {
      log(`preview exited (code ${code}); waiting for the next change to relaunch`)
      child = null
    }
  })
  log('preview launched')
}

function build() {
  building = true
  rebuildQueued = false
  log('building…')

  // --message-format=json-render-diagnostics keeps human-readable diagnostics on stderr while giving
  // us machine-readable artifact lines on stdout, so we can locate the freshly built executable
  // without hardcoding the workspace target path.
  const cargo = spawn(
    'cargo',
    [
      'build',
      '--manifest-path',
      manifest,
      '--bin',
      'overlay-preview',
      '--features',
      'preview',
      '--message-format=json-render-diagnostics',
    ],
    // Run from the crate dir so cargo discovers game/.cargo/config.toml (the i686 target +
    // crt-static rustflags the overlay-ui build expects). Running from the repo root would miss it
    // and rebuild the whole graph into a different, host-default target dir every time.
    { stdio: ['ignore', 'pipe', 'inherit'], cwd: crateDir },
  )

  let stdout = ''
  cargo.stdout.setEncoding('utf8')
  cargo.stdout.on('data', chunk => {
    stdout += chunk
  })

  cargo.on('exit', code => {
    building = false
    if (code !== 0) {
      log(`build failed (exit ${code}); keeping the running preview, waiting for the next change`)
      maybeRebuild()
      return
    }

    const exePath = findExecutable(stdout)
    if (!exePath) {
      log('build succeeded but no executable artifact was reported; not relaunching')
      maybeRebuild()
      return
    }
    launch(exePath)
    maybeRebuild()
  })
}

// Pulls the `overlay-preview` executable path out of cargo's JSON artifact stream.
function findExecutable(stdout) {
  let exe = null
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue
    let msg
    try {
      msg = JSON.parse(line)
    } catch {
      continue
    }
    if (
      msg.reason === 'compiler-artifact' &&
      msg.executable &&
      msg.target?.name === 'overlay-preview'
    ) {
      exe = msg.executable
    }
  }
  return exe
}

// Runs a queued build if one was requested mid-build; otherwise idles until the next change.
function maybeRebuild() {
  if (rebuildQueued && !building) {
    build()
  }
}

function onChange(filename) {
  if (filename && !filename.endsWith('.rs')) return
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    if (building) {
      rebuildQueued = true
    } else {
      build()
    }
  }, DEBOUNCE_MS)
}

log(`watching ${srcDir} — edit an overlay render fn and save to rebuild + relaunch`)
watch(srcDir, { recursive: true }, (_event, filename) => onChange(filename))

process.on('SIGINT', () => {
  log('shutting down')
  killChild()
  process.exit(0)
})

// Initial build so the app is up immediately.
build()
