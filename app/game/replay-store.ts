import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import log from '../logger'

/**
 * A simple cache store for downloaded replays. Unlike `MapStore`, this doesn't handle downloading -
 * the renderer does that so it can show progress.
 */
export class ReplayStore {
  private dirCreated: Promise<string | undefined>

  constructor(readonly basePath: string) {
    this.dirCreated = mkdir(basePath, { recursive: true })
  }

  private getPath(replayId: string): string {
    // Use last 2 chars as subdirectory to avoid too many files in one folder
    // (last chars have higher entropy than first chars in our UUIDs)
    const subDir = replayId.slice(-2)
    return path.join(this.basePath, subDir, `${replayId}.rep`)
  }

  /**
   * Checks if a replay exists in the cache with the correct hash.
   * Returns the file path if valid, null otherwise.
   */
  async getPathIfExists(replayId: string, expectedHash: string): Promise<string | null> {
    await this.dirCreated
    const replayPath = this.getPath(replayId)

    try {
      await stat(replayPath)
    } catch {
      // File doesn't exist
      return null
    }

    // Verify hash
    try {
      const fileData = await readFile(replayPath)
      const hash = createHash('sha256').update(fileData).digest('hex')

      if (hash === expectedHash) {
        log.verbose(`Replay ${replayId} found in cache`)
        return replayPath
      }

      log.verbose(`Cached replay ${replayId} has wrong hash '${hash}', expected '${expectedHash}'`)
      return null
    } catch (err) {
      log.error(`Error verifying cached replay: ${(err as any).stack ?? err}`)
      return null
    }
  }

  /**
   * Stores replay data in the cache after verifying the hash.
   * Returns the file path where the replay was stored.
   * Throws if the hash doesn't match.
   */
  async storeReplay(replayId: string, expectedHash: string, data: ArrayBuffer): Promise<string> {
    await this.dirCreated

    // Verify hash before storing
    const hash = createHash('sha256').update(Buffer.from(data)).digest('hex')
    if (hash !== expectedHash) {
      throw new Error(`Replay hash mismatch: expected '${expectedHash}', got '${hash}'`)
    }

    const replayPath = this.getPath(replayId)
    await mkdir(path.dirname(replayPath), { recursive: true })
    await writeFile(replayPath, Buffer.from(data))

    log.verbose(`Stored replay ${replayId} at ${replayPath}`)
    return replayPath
  }
}
