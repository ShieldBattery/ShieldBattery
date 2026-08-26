import { createHash } from 'node:crypto'
import { readFile, unlink } from 'node:fs/promises'
import path from 'node:path'
import { SAVE_SUBFOLDER } from './replay-save-naming'
import { isPathUnderRoot } from './replay-watcher-paths'

/**
 * Whether `filePath` sits inside the `ShieldBattery` save subfolder of one of `watchedFolders`.
 * Pure (no filesystem access) so it can be unit-tested directly; the containment check itself
 * (case-insensitive, separator-normalizing, `..`-resistant) is `isPathUnderRoot`'s.
 */
export function isWithinSaveFolders(
  filePath: string,
  watchedFolders: ReadonlyArray<string>,
): boolean {
  return watchedFolders.some(folder =>
    isPathUnderRoot(filePath, path.win32.join(folder, SAVE_SUBFOLDER)),
  )
}

/**
 * Whether `filePath` sits inside one of `watchedFolders` themselves -- not their `ShieldBattery`
 * save subfolder, since an already-indexed replay can live anywhere under a watched folder, not
 * just there. Pure (no filesystem access) so it can be unit-tested directly; the containment check
 * itself (case-insensitive, separator-normalizing, `..`-resistant) is `isPathUnderRoot`'s.
 */
export function isWithinWatchedFolders(
  filePath: string,
  watchedFolders: ReadonlyArray<string>,
): boolean {
  return watchedFolders.some(folder => isPathUnderRoot(filePath, folder))
}

/**
 * Deletes a replay file previously written by `saveReplayToLibrary`, used to undo a fresh
 * "Save replay". Two guards keep this from being turned into an arbitrary-file-delete primitive:
 * `filePath` must resolve inside the `ShieldBattery` save subfolder of one of `watchedFolders`
 * (throws otherwise -- a bug on the caller's side, not a normal outcome), and its current content
 * must still hash to `expectedHash` (returns `false` otherwise -- normal if it was already removed,
 * or has since been overwritten). The local index isn't touched here; the watcher's own reconcile
 * un-indexes the file (cascading any playlist membership) once it notices the deletion.
 */
export async function removeSavedReplay(
  filePath: string,
  expectedHash: string,
  watchedFolders: ReadonlyArray<string>,
): Promise<boolean> {
  if (!isWithinSaveFolders(filePath, watchedFolders)) {
    throw new Error(`Refusing to remove a replay outside the saved-replays folder: ${filePath}`)
  }

  let buffer: Buffer
  try {
    buffer = await readFile(filePath)
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
      return false
    }
    throw err
  }

  const actualHash = createHash('sha256').update(buffer).digest('hex')
  if (actualHash !== expectedHash) {
    return false
  }

  await unlink(filePath)
  return true
}
