import { net } from 'electron'
import fs, { promises as fsPromises } from 'fs'
import { Map } from 'immutable'
import { mkdirp } from 'mkdirp'
import path from 'path'
import { Readable } from 'stream'
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
      const res = await net.fetch(mapUrl)
      if (!res.ok) {
        throw new Error(`Failed to download map: ${res.status} ${res.statusText}`)
      }
      if (!res.body) {
        throw new Error(`Failed to download map, response had no body`)
      }

      const hasher = new HashThrough()
      hasher.hasher.update(mapFormat)
      // NOTE(tec27): The type of `body` doesn't say it has asyncIterator for some reason but it
      // should? Not really sure why the types don't align here
      const doneWriting = pipeline(
        Readable.fromWeb(res.body as any),
        hasher,
        fs.createWriteStream(mapPath),
      )
      hasher.resume()
      await doneWriting

      const hash = await hasher.hashPromise
      if (hash !== mapHash) {
        throw new Error(`Downloaded map has hash '${hash}' but expected '${mapHash}'`)
      }

      log.verbose(`Map download completed successfully`)
      return true
    } catch (err) {
      log.error(`Error checking/downloading map: ${(err as any).stack ?? err}`)
      throw err
    } finally {
      this.activeDownloads = this.activeDownloads.delete(mapHash)
    }
  }
}
