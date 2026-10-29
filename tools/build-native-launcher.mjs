import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, renameSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(path.join(ROOT, 'app/package.json'))

/** Replace the installed artifact without modifying pnpm's hard-linked package-store bytes. */
export function installNativeLauncher(source, destination) {
  const staged = path.join(path.dirname(destination), `.launcher-${randomUUID()}.tmp`)
  try {
    copyFileSync(source, staged)
    renameSync(staged, destination)
  } finally {
    rmSync(staged, { force: true })
  }
}

/** Builds the pinned, source-patched launcher used by the Windows Electron app. */
export function buildNativeLauncher(mode = 'build') {
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    throw new Error('Native launcher requires Windows x64 with the Rust MSVC toolchain')
  }
  const packageRoot = path.dirname(require.resolve('@shieldbattery/stimpack/package.json'))
  const native = path.join(packageRoot, 'native')
  if (!existsSync(path.join(native, 'src/launch_owner.rs'))) {
    throw new Error('Native launcher source patch missing; run pnpm install in app/')
  }
  const commands = {
    test: ['test', '--locked', '--all-targets'],
    check: ['clippy', '--locked', '--all-targets'],
    build: ['build', '--locked', '--release'],
  }
  const args = commands[mode]
  if (!args) throw new Error(`Unknown native launcher mode: ${mode}`)
  args.push('--target=x86_64-pc-windows-msvc')
  if (mode === 'check') args.push('--', '-D', 'warnings')
  const result = spawnSync('cargo', args, {
    cwd: native,
    stdio: 'inherit',
    env: {
      ...process.env,
      CARGO_TARGET_DIR: path.join(native, 'target'),
      CARGO_INCREMENTAL: '0',
      CARGO_PROFILE_DEV_DEBUG: '1',
      CARGO_PROFILE_TEST_DEBUG: '1',
    },
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Native launcher ${mode} failed (${result.status})`)
  if (mode === 'build') {
    installNativeLauncher(
      path.join(native, 'target/x86_64-pc-windows-msvc/release/stimpack.dll'),
      path.join(packageRoot, 'prebuilds/x64.node'),
    )
    const launcher = require('@shieldbattery/stimpack')
    if (
      typeof launcher.createLaunchOwner !== 'function' ||
      typeof launcher.terminateLaunchOwner !== 'function'
    ) {
      throw new Error('Built native launcher is missing ownership exports')
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let mode = 'build'
  if (process.argv.includes('--test')) mode = 'test'
  else if (process.argv.includes('--check')) mode = 'check'
  buildNativeLauncher(mode)
}
