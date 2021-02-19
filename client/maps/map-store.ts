import fs, { promises as fsPromises } from 'fs'
import { Map } from 'immutable'
import mkdirp from 'mkdirp'
import path from 'path'
import HashThrough from '../../common/hash-through'
import log from '../logging/logger'
import { fetchReadableStream } from '../network/fetch'

export class MapStore {
  private dirCreated: Promise<string | undefined>
  private activeDownloads = Map<string, Promise<boolean>>()

  constructor(readonly basePath: string) {
    this.dirCreated = mkdirp(basePath)
  }

  // TODO(tec27): mapFormat can be a string enum instead?
  getPath(mapHash: string, mapFormat: string): string {
    const b64 = Buffer.from(mapHash, 'hex').toString('base64')
    // Goal of dirs is twofold:
    // - Avoid a huge number of files in a single directory
    // - Get the resulting filename under 32 characters (necessary because BW checks this =/)
    const firstDir = mapHash.substr(0, 2)
    const secondDir = b64
    return path.join(this.basePath, firstDir, secondDir, `map.${mapFormat}`)
  }

  async downloadMap(mapHash: string, mapFormat: string, mapUrl: string): Promise<boolean> {
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
    mapFormat: string,
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
        fs.createReadStream(mapPath).pipe(hasher)
        hasher.resume()
        try {
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
      await new Promise((resolve, reject) => {
        const outStream = fs.createWriteStream(mapPath)
        outStream.on('error', reject).on('finish', resolve)
        fetchReadableStream(mapUrl, {
          headers: { Accept: 'application/octet-stream' },
          credentials: 'omit',
        })
          .on('error', reject)
          .pipe(outStream)
      })

      return true
    } finally {
      this.activeDownloads = this.activeDownloads.delete(mapHash)
    }
  }
}
