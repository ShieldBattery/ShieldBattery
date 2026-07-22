import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import log from '../logger'
import { pickSaveFilename, sanitizeBaseFilename } from './replay-save-naming'

/** Subfolder (under the watched replay folder) that saved server replays are written into. */
const SAVE_SUBFOLDER = 'ShieldBattery'

/**
 * Downloads-and-saves flow for "Save replay": verifies the downloaded bytes against the server's
 * hash, then writes them into the watched replay folder (under a `ShieldBattery` subfolder) so the
 * local replay library indexes them on its own -- this doesn't touch the index directly.
 *
 * Returns the absolute path the replay was saved at, plus `alreadyExists: true` when an identical
 * file (same content hash) was already present there and left in place rather than rewritten.
 */
export async function saveReplayToLibrary(
  watchedFolder: string,
  gameId: string,
  filename: string,
  expectedHash: string,
  data: ArrayBuffer,
): Promise<{ path: string; alreadyExists: boolean }> {
  const buffer = Buffer.from(data)
  const actualHash = createHash('sha256').update(buffer).digest('hex')
  if (actualHash !== expectedHash) {
    throw new Error(`Replay hash mismatch: expected '${expectedHash}', got '${actualHash}'`)
  }

  const destDir = path.join(watchedFolder, SAVE_SUBFOLDER)
  await mkdir(destDir, { recursive: true })

  const baseName = sanitizeBaseFilename(filename)
  const { name, alreadyExists } = await pickSaveFilename(baseName, expectedHash, async name => {
    try {
      const existing = await readFile(path.join(destDir, name))
      return createHash('sha256').update(existing).digest('hex')
    } catch (err: any) {
      if (err?.code === 'ENOENT') {
        return undefined
      }
      throw err
    }
  })

  const savePath = path.join(destDir, name)
  if (alreadyExists) {
    log.verbose(`Replay for game ${gameId} already saved at ${savePath}`)
    return { path: savePath, alreadyExists: true }
  }

  await writeFile(savePath, buffer)
  log.verbose(`Saved replay for game ${gameId} to ${savePath}`)
  return { path: savePath, alreadyExists: false }
}
