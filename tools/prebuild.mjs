// Builds an optional companion package before the app is bundled, when the build environment points
// at one. With none configured this does nothing, so a plain checkout builds unchanged.
//
// Usage: node tools/prebuild.mjs [--release]
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

function readBuildEnv() {
  const file = path.join(ROOT, '.env-build')
  return existsSync(file) ? parseEnv(readFileSync(file, 'utf8')) : {}
}

/** The nearest directory at or above `start` that holds a package.json. */
function packageRoot(start) {
  for (let dir = start; ; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, 'package.json'))) return dir
    if (path.dirname(dir) === dir) return undefined
  }
}

const isRelease = process.argv.includes('--release')
// .env-build configures release builds only; a development build prebuilds nothing unless the
// environment names an entry itself.
const entry = process.env.SB_PREBUILD ?? (isRelease ? readBuildEnv().SB_PREBUILD : undefined)

if (isRelease) {
  const companion = process.env.SB_GAME_COMPANION
  const entryPath = entry && path.resolve(ROOT, entry)
  const companionPath = companion && path.resolve(ROOT, companion)
  const validEntry = entryPath && existsSync(entryPath) && statSync(entryPath).isFile()
  const validCompanion =
    companionPath &&
    existsSync(companionPath) &&
    statSync(companionPath).isDirectory() &&
    existsSync(path.join(companionPath, 'lib.rs')) &&
    statSync(path.join(companionPath, 'lib.rs')).isFile()

  if (!validEntry || !validCompanion) {
    console.error('Release build requires a valid companion configuration.')
    process.exit(1)
  }
}

if (!entry) {
  process.exit(0)
}

const root = packageRoot(path.dirname(path.resolve(ROOT, entry)))
if (!root) {
  console.error(
    isRelease
      ? 'Release build requires a valid companion configuration.'
      : `No package.json found above ${entry}`,
  )
  process.exit(1)
}

const script = isRelease ? 'build:release' : 'build'
// shell: true resolves pnpm's .cmd shim on Windows; the environment passes through.
const result = spawnSync(`pnpm run --if-present ${script}`, {
  cwd: root,
  stdio: 'inherit',
  shell: true,
})
process.exit(result.status ?? 1)
