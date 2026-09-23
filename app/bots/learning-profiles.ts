/**
 * Learning profiles: the writable working copy a bot runs from.
 *
 * Bots resolve their configuration and `bwapi-data` relative to their working directory, so a
 * profile is a copy of the package's launch working directory rather than an empty folder, and the
 * package directory itself stays untouched and immutable. Each concurrently running instance of
 * the same bot gets its own copy, since a bot's saved state is rarely safe for two writers.
 */

import { randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { BotKey } from '../../common/bots/bot-library'

/** The package files a profile is seeded from and the parts of it the bot writes to. */
export interface ProfileBaseline {
  /** Absolute path to the package's launch working directory. */
  directory: string
  /** Paths inside that directory the bot writes to. */
  writablePaths: string[]
}

/**
 * A bot key as a directory name. Bot IDs are already `[a-z0-9-]`, and local build keys are
 * `local:<uuid>`, whose colon Windows would read as a drive or stream separator.
 */
export function profileDirectoryName(key: BotKey): string {
  return key.replace(/[^a-zA-Z0-9-]/g, '_')
}

/** The working copy for one instance: `work` for the first, `work-2`, `work-3`... after it. */
export function workingCopyName(instanceIndex: number): string {
  return instanceIndex === 0 ? 'work' : `work-${instanceIndex + 1}`
}

/**
 * Re-expresses a package-relative writable directory as a path inside the working copy, which
 * holds the launch working directory's subtree. Returns undefined for a directory outside that
 * subtree, which no working copy can contain.
 */
export function profileRelativeWritablePath(
  workingDirectory: string,
  writableDirectory: string,
): string | undefined {
  const base = workingDirectory.replaceAll('\\', '/').replace(/\/+$/, '')
  const writable = writableDirectory.replaceAll('\\', '/').replace(/\/+$/, '')
  if (base === '.' || base === '') {
    return writable
  }
  if (writable === base) {
    return '.'
  }
  if (writable.startsWith(`${base}/`)) {
    return writable.slice(base.length + 1)
  }
  return undefined
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.stat(target)
    return true
  } catch {
    return false
  }
}

async function copyTree(from: string, to: string): Promise<void> {
  await fs.mkdir(path.dirname(to), { recursive: true })
  await fs.cp(from, to, { recursive: true, force: true })
}

/**
 * Returns the working directory for one instance of a bot, creating it from the package baseline
 * the first time. The copy is assembled under a temporary name so an interrupted seed never leaves
 * a half-populated profile behind.
 */
export async function ensureWorkingCopy({
  profilesRoot,
  key,
  instanceIndex,
  baseline,
}: {
  profilesRoot: string
  key: BotKey
  instanceIndex: number
  baseline?: ProfileBaseline
}): Promise<string> {
  const profileDirectory = path.join(profilesRoot, profileDirectoryName(key))
  const workingCopy = path.join(profileDirectory, workingCopyName(instanceIndex))
  if (await pathExists(workingCopy)) {
    return workingCopy
  }

  await fs.mkdir(profileDirectory, { recursive: true })
  if (!baseline) {
    await fs.mkdir(workingCopy, { recursive: true })
    return workingCopy
  }

  const staging = `${workingCopy}.seeding-${randomBytes(6).toString('hex')}`
  try {
    await copyTree(baseline.directory, staging)
    await fs.rename(staging, workingCopy)
  } catch (err) {
    await fs.rm(staging, { recursive: true, force: true })
    // Another instance of the same bot may have won the race to seed this copy.
    if (await pathExists(workingCopy)) {
      return workingCopy
    }
    throw err
  }
  return workingCopy
}

async function listWorkingCopies(profileDirectory: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(profileDirectory, { withFileTypes: true })
    return entries
      .filter(entry => entry.isDirectory() && /^work(-\d+)?$/.test(entry.name))
      .map(entry => path.join(profileDirectory, entry.name))
  } catch {
    return []
  }
}

async function* walkFiles(root: string): AsyncGenerator<string> {
  let entries
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = path.join(root, entry.name)
    if (entry.isDirectory()) {
      yield* walkFiles(full)
    } else if (entry.isFile()) {
      yield full
    }
  }
}

async function hasAnyFile(root: string): Promise<boolean> {
  for await (const file of walkFiles(root)) {
    if (file) {
      return true
    }
  }
  return false
}

/**
 * Whether a bot has written anything of its own: a file under one of its writable paths that the
 * package baseline doesn't have, or that no longer matches the baseline's size.
 */
export async function hasLearningData({
  profilesRoot,
  key,
  baseline,
}: {
  profilesRoot: string
  key: BotKey
  baseline?: ProfileBaseline
}): Promise<boolean> {
  const profileDirectory = path.join(profilesRoot, profileDirectoryName(key))
  const workingCopies = await listWorkingCopies(profileDirectory)
  if (!workingCopies.length) {
    return false
  }
  if (!baseline) {
    // Without a package to compare against, any file in the profile is the bot's own.
    for (const workingCopy of workingCopies) {
      if (await hasAnyFile(workingCopy)) {
        return true
      }
    }
    return false
  }

  for (const workingCopy of workingCopies) {
    for (const writablePath of baseline.writablePaths) {
      const profileSubtree = path.resolve(workingCopy, writablePath)
      const baselineSubtree = path.resolve(baseline.directory, writablePath)
      for await (const file of walkFiles(profileSubtree)) {
        const relative = path.relative(profileSubtree, file)
        try {
          const [profileStats, baselineStats] = await Promise.all([
            fs.stat(file),
            fs.stat(path.join(baselineSubtree, relative)),
          ])
          if (profileStats.size !== baselineStats.size) {
            return true
          }
        } catch {
          return true
        }
      }
    }
  }
  return false
}

/**
 * Restores every working copy's writable paths to the package baseline, leaving the rest of the
 * copy (configuration the user may have edited by hand) alone.
 */
export async function resetLearning({
  profilesRoot,
  key,
  baseline,
}: {
  profilesRoot: string
  key: BotKey
  baseline: ProfileBaseline
}): Promise<void> {
  const profileDirectory = path.join(profilesRoot, profileDirectoryName(key))
  for (const workingCopy of await listWorkingCopies(profileDirectory)) {
    for (const writablePath of baseline.writablePaths) {
      const profileSubtree = path.resolve(workingCopy, writablePath)
      const baselineSubtree = path.resolve(baseline.directory, writablePath)
      await fs.rm(profileSubtree, { recursive: true, force: true })
      if (await pathExists(baselineSubtree)) {
        await copyTree(baselineSubtree, profileSubtree)
      }
    }
  }
}
