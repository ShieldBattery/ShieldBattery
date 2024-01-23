import fs, { promises as fsPromises } from 'fs'
import got from 'got'
import { Map } from 'immutable'
import { mkdirp } from 'mkdirp'
import path from 'path'
import { pipeline } from 'stream/promises'
import HashThrough from '../../common/hash-through'
import { MapExtension } from '../../common/maps'
import log from '../logger'

export class MapStore {
  private dirCreated: Promise<string | void | undefined>
  private activeDownloads = Map<string, Promise<boolean>>()

  constructor(readonly basePath: string) {
    this.dirCreated = mkdirp(basePath)
  }

  getPath(mapHash: string, mapFormat: MapExtension): string {
    const b64 = Buffer.from(mapHash, 'hex').toString('base64')
    // Goal of dirs is twofold:
    // - Avoid a huge number of files in a single directory
    // - Get the resulting filename under 32 characters (necessary because BW checks this =/)
    const firstDir = mapHash.slice(0, 2)
    const secondDir = b64
    return path.join(this.basePath, firstDir, secondDir, `map.${mapFormat}`)
  }

  async downloadMap(mapHash: string, mapFormat: MapExtension, mapUrl: string): Promise<boolean> {
    if (!this.activeDownloads.has(mapHash)) {
      this.activeDownloads = this.activeDownloads.set(
        mapHash,
        this.checkAndDownloadMap(mapHash, mapFormat, mapUrl),
      )
    }

    return this.activeDownloads.get(mapHash)!
  }

  private async checkAndDownloadMap(
    mapHash: string,
    mapFormat: MapExtension,
    mapUrl: string,
  ): Promise<boolean> {
    await this.dirCreated
    const mapPath = this.getPath(mapHash, mapFormat)

    let exists = false
    try {
      await fsPromises.stat(mapPath)
      exists = true
    } catch (ignored) {
      // error just means the file doesn't exist (most likely)
    }

    try {
      if (exists) {
        const hasher = new HashThrough()
        hasher.hasher.update(mapFormat)
        const doneReading = pipeline(fs.createReadStream(mapPath), hasher)
        hasher.resume()
        try {
          await doneReading
          const hash = await hasher.hashPromise
          if (hash === mapHash) {
            return true
          }

          log.verbose(`Expected map to have hash '${mapHash}' but found '${hash}', redownloading`)
        } catch (ignored) {
          // If there was an error reading the file, then re-download it
        }
      }

      await mkdirp(path.dirname(mapPath))
      log.verbose(`Downloading map from ${mapUrl} to ${mapPath}`)
      await pipeline(got.stream(mapUrl), fs.createWriteStream(mapPath))
      return true
    } catch (err) {
      log.error(`Error checking/downloading map: ${(err as any).stack ?? err}`)
      throw err
    } finally {
      this.activeDownloads = this.activeDownloads.delete(mapHash)
    }
  }
}
