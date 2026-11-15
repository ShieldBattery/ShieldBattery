#!/usr/bin/env node
// Runs the game DLL's pre-handoff checks and prints a compact summary.
//
//   node game/gates.mjs                 fmt, clippy, clippy-release, test
//   node game/gates.mjs --build         the above plus clippy-release-x86, build, build-x86
//   node game/gates.mjs --only a,b      run exactly the named steps
//   node game/gates.mjs --skip a,b      run the default steps minus the named ones
//
// Every selected step runs even if an earlier one fails. The exit code is non-zero if any step
// failed. Full output of each step is written to a log under the OS temp directory.
//
// Everything resolves relative to this file, so the working directory and the shell (Git Bash,
// PowerShell, cmd) make no difference, and a git worktree uses its own `game/` directory. The
// environment is passed to the child processes unmodified.

import { spawn } from 'node:child_process'
import { createWriteStream, mkdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const gameDir = path.dirname(fileURLToPath(import.meta.url))
const distDir = path.join(gameDir, 'dist')
const X64_TRIPLE = 'x86_64-pc-windows-msvc'
const X86_TRIPLE = 'i686-pc-windows-msvc'

/** Maximum number of lines of failure detail printed per step. */
const MAX_DETAIL_LINES = 40

const clippyArgs = ['clippy', '--all-targets', '--workspace']

/**
 * `group` is 'default' for steps that run without flags and 'build' for the ones `--build` adds.
 * `detail` extracts the human-relevant part of a failing step's output.
 */
const STEPS = [
  {
    name: 'fmt',
    group: 'default',
    run: () => cargo(['fmt', '--all', '--', '--check']),
    detail: fmtDetail,
  },
  {
    name: 'clippy',
    group: 'default',
    run: () => cargo([...clippyArgs, '--', '-D', 'warnings']),
    detail: compilerDetail,
  },
  {
    name: 'clippy-release',
    group: 'default',
    run: () => cargo([...clippyArgs, '--release', '--', '-D', 'warnings']),
    detail: compilerDetail,
  },
  {
    name: 'test',
    group: 'default',
    run: () => cargo(['test', '--workspace', '--no-fail-fast']),
    detail: testDetail,
    note: testNote,
  },
  {
    name: 'clippy-release-x86',
    group: 'build',
    run: () => cargo([...clippyArgs, '--release', '--target', X86_TRIPLE, '--', '-D', 'warnings']),
    detail: compilerDetail,
  },
  {
    name: 'build',
    group: 'build',
    run: () => buildBat([]),
    detail: buildDetail,
    note: () => dllNote('shieldbattery_64.dll', X64_TRIPLE),
  },
  {
    name: 'build-x86',
    group: 'build',
    run: () => buildBat(['x86']),
    detail: buildDetail,
    note: () => dllNote('shieldbattery.dll', X86_TRIPLE),
  },
]

function cargo(args) {
  return { command: 'cargo', args, options: {} }
}

// cmd.exe is given the batch file's absolute path and the command line verbatim. The output is
// captured through a pipe to this process, and the exit code is cmd's own, so nothing downstream
// can mask a build failure.
function buildBat(args) {
  const batch = path.join(gameDir, 'build.bat')
  const commandLine = ['"' + batch + '"', ...args].join(' ')
  return {
    command: process.env.ComSpec ?? 'cmd.exe',
    args: ['/d', '/s', '/c', '"' + commandLine + '"'],
    options: { windowsVerbatimArguments: true },
  }
}

function parseArgs(argv) {
  const opts = { build: false, only: null, skip: [] }
  const names = STEPS.map(s => s.name)
  const list = (flag, value) => {
    if (value === undefined) {
      fail(`${flag} needs a comma-separated list of step names`)
    }
    const items = value.split(',').filter(Boolean)
    const unknown = items.filter(i => !names.includes(i))
    if (unknown.length || !items.length) {
      fail(`unknown step ${unknown.join(', ') || '(none given)'}; steps are ${names.join(', ')}`)
    }
    return items
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--build') {
      opts.build = true
    } else if (arg === '--only') {
      opts.only = list(arg, argv[++i])
    } else if (arg.startsWith('--only=')) {
      opts.only = list('--only', arg.slice('--only='.length))
    } else if (arg === '--skip') {
      opts.skip.push(...list(arg, argv[++i]))
    } else if (arg.startsWith('--skip=')) {
      opts.skip.push(...list('--skip', arg.slice('--skip='.length)))
    } else if (arg === '--help' || arg === '-h') {
      console.log(
        `usage: node game/gates.mjs [--build] [--only a,b] [--skip a,b]\n` +
          `default steps: ${STEPS.filter(s => s.group === 'default')
            .map(s => s.name)
            .join(', ')}\n` +
          `--build adds: ${STEPS.filter(s => s.group === 'build')
            .map(s => s.name)
            .join(', ')}`,
      )
      process.exit(0)
    } else {
      fail(`unknown argument ${arg}; try --help`)
    }
  }
  return opts
}

function fail(message) {
  console.error(`gates: ${message}`)
  process.exit(2)
}

function selectSteps(opts) {
  if (opts.only) {
    return STEPS.filter(s => opts.only.includes(s.name))
  }
  return STEPS.filter(s => (s.group === 'default' || opts.build) && !opts.skip.includes(s.name))
}

const ANSI = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*[A-Za-z]', 'g')

function runStep(step, logPath) {
  const { command, args, options } = step.run()
  return new Promise(resolve => {
    const log = createWriteStream(logPath)
    log.write(`$ ${command} ${args.join(' ')}\n(cwd ${gameDir})\n\n`)
    const chunks = []
    const started = Date.now()
    const child = spawn(command, args, {
      cwd: gameDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    })
    const collect = chunk => {
      chunks.push(chunk)
      log.write(chunk)
    }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
    const finish = (code, spawnError) => {
      const output = Buffer.concat(chunks).toString('utf8').replace(ANSI, '').replace(/\r\n/g, '\n')
      if (spawnError) {
        log.write(`\ncould not start ${command}: ${spawnError.message}\n`)
      }
      log.write(`\n[exit code ${code}]\n`)
      log.end(() =>
        resolve({
          code,
          output: spawnError ? `could not start ${command}: ${spawnError.message}` : output,
          ms: Date.now() - started,
        }),
      )
    }
    child.on('error', error => finish(-1, error))
    child.on('close', code => finish(code ?? -1))
  })
}

/** Splits text into blank-line-separated blocks. */
function blocks(text) {
  return text
    .split(/\n\s*\n/)
    .map(b => b.trimEnd())
    .filter(Boolean)
}

function fmtDetail(output) {
  const files = [...new Set([...output.matchAll(/^Diff in (.+?):\d+:?$/gm)].map(m => m[1]))]
  if (!files.length) {
    return tail(output)
  }
  const relative = files.map(f => path.relative(gameDir, f.replace(/^\\\\\?\\/, '')) || f)
  return [`${relative.length} file(s) need formatting (run \`cargo fmt --all\`):`, ...relative]
}

// Compiler and clippy diagnostics are blocks that start with `error` or `warning` at column 0 and
// run to the next blank line. Cargo's closing summaries ("could not compile", "test failed",
// "generated N warnings") are not diagnostics.
function diagnosticBlocks(output, severities) {
  const start = new RegExp(`^(${severities})(\\[[^\\]]+\\])?: `)
  return blocks(output).filter(
    b =>
      start.test(b) &&
      !/^(error|warning): (could not compile|test failed|\d+ targets? failed|`[^`]+` \([^)]*\) generated)/.test(
        b,
      ),
  )
}

function joinBlocks(found) {
  return found.flatMap((b, i) => (i ? ['', ...b.split('\n')] : b.split('\n')))
}

function compilerDetail(output) {
  const found = diagnosticBlocks(output, 'error|warning')
  return found.length ? joinBlocks(found) : tail(output)
}

function testDetail(output) {
  const lines = joinBlocks(diagnosticBlocks(output, 'error'))
  // Each failing test prints `---- name stdout ----` followed by its panic message.
  const failureBlocks = [
    ...output.matchAll(
      /^---- (.+?) (?:stdout|stderr) ----\n([\s\S]*?)(?=\n---- |\nfailures:\n|\ntest result:|(?![\s\S]))/gm,
    ),
  ]
  for (const [, name, body] of failureBlocks) {
    const trimmed = body
      .split('\n')
      .filter(l => l.trim() && !/^note: run with `RUST_BACKTRACE/.test(l))
    lines.push(`FAILED ${name}`, ...trimmed.map(l => '  ' + l))
  }
  if (!failureBlocks.length && !lines.length) {
    const failedNames = [...output.matchAll(/^test (\S+) \.\.\. FAILED$/gm)].map(m => m[1])
    return failedNames.length ? failedNames.map(n => `FAILED ${n}`) : tail(output)
  }
  const summaries = output.split('\n').filter(l => /^test result: FAILED/.test(l))
  return [...lines, ...summaries]
}

function testNote(output) {
  let passed = 0
  let ignored = 0
  for (const m of output.matchAll(/^test result: ok\. (\d+) passed;.*?(\d+) ignored/gm)) {
    passed += Number(m[1])
    ignored += Number(m[2])
  }
  return `${passed} tests${ignored ? `, ${ignored} ignored` : ''}`
}

function buildDetail(output) {
  const lines = []
  if (/being used by another process|cannot access the file/i.test(output)) {
    lines.push(
      'The DLL could not be copied into dist/ because a running process has it locked, most',
      'likely a StarCraft game that injected it. Close the game and run the build again.',
      '',
    )
  }
  const errors = diagnosticBlocks(output, 'error')
  if (errors.length) {
    lines.push(...joinBlocks(errors))
  } else if (!lines.length) {
    lines.push(...tail(output))
  } else {
    lines.push(...tail(output, 6))
  }
  return lines
}

function tail(output, count = 15) {
  const lines = output.split('\n').filter(l => l.trim())
  return lines.slice(-count)
}

function formatAge(ms) {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 90) return `${s}s ago`
  if (s < 5400) return `${Math.round(s / 60)}m ago`
  return `${Math.round(s / 3600)}h ago`
}

function formatTime(date) {
  const pad = n => String(n).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  )
}

// `build.bat` copies the DLL with its source modification time, so a dist DLL that is current has
// the same timestamp as the cargo output it was copied from.
function dllNote(file, triple) {
  const dist = path.join(distDir, file)
  try {
    const distTime = statSync(dist).mtime
    const built = path.join(gameDir, 'target', triple, 'debug', 'shieldbattery.dll')
    let verdict = ''
    try {
      verdict =
        Math.abs(statSync(built).mtimeMs - distTime.getTime()) < 2000
          ? ''
          : ' (STALE: differs from target build)'
    } catch {
      verdict = ' (no matching target build found)'
    }
    return `dist/${file} ${formatTime(distTime)} (${formatAge(Date.now() - distTime.getTime())})${verdict}`
  } catch {
    return `dist/${file} is missing`
  }
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  return `${Math.floor(s / 60)}m${String(Math.round(s % 60)).padStart(2, '0')}s`
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const steps = selectSteps(opts)
  if (!steps.length) {
    fail('no steps selected')
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const logDir = path.join(tmpdir(), 'sb-game-gates', stamp)
  mkdirSync(logDir, { recursive: true })

  if (process.env.CARGO_TARGET_DIR && steps.some(s => s.name.startsWith('build'))) {
    console.log(
      'note: CARGO_TARGET_DIR is set; build.bat copies from game/target, so dist/ may not ' +
        'receive this build',
    )
  }

  const width = Math.max(...steps.map(s => s.name.length))
  const results = []
  for (const step of steps) {
    const logPath = path.join(logDir, `${step.name}.log`)
    const result = await runStep(step, logPath)
    const ok = result.code === 0
    const note = ok && step.note ? `  ${step.note(result.output)}` : ''
    console.log(
      `${step.name.padEnd(width)}  ${ok ? 'PASS' : 'FAIL'}  ${formatDuration(result.ms)}${note}`,
    )
    if (!ok) {
      const detail = step.detail(result.output)
      const shown = detail.slice(0, MAX_DETAIL_LINES)
      for (const line of shown) console.log(`    ${line}`)
      if (detail.length > shown.length) {
        console.log(`    ... ${detail.length - shown.length} more lines`)
      }
      console.log(`    exit code ${result.code}; full log: ${logPath}`)
    }
    results.push({ step, ok })
  }

  const failed = results.filter(r => !r.ok).map(r => r.step.name)
  console.log(
    failed.length
      ? `${failed.length} of ${results.length} steps FAILED: ${failed.join(', ')} (logs in ${logDir})`
      : `all ${results.length} steps passed (logs in ${logDir})`,
  )
  process.exitCode = failed.length ? 1 : 0
}

main()
