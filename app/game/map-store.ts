import { net } from 'electron'
import isDev from 'electron-is-dev'
import fs, { promises as fsPromises } from 'fs'
import { mkdirp } from 'mkdirp'
import path from 'path'
import { Readable, Transform } from 'stream'
import { pipeline } from 'stream/promises'
import HashThrough from '../../common/hash-through'
import { MapExtension } from '../../common/maps'
import log from '../logger'

/** How long a map download may go without receiving any data before it's given up on. */
const DOWNLOAD_IDLE_MS = 30_000

// Dev-only stand-ins for a member on a slow or broken connection, to see how lobbies and game
// launches treat someone who doesn't have the map yet. Dev instances share one map store, so a map
// the host already has would otherwise be ready for everyone at once. Both apply to every map this
// instance checks, whether or not it's already on disk.
/** `SB_MAP_DOWNLOAD_DELAY_MS`: how long each map check waits before it starts. */
const DEBUG_DOWNLOAD_DELAY_MS = isDev ? Number(process.env.SB_MAP_DOWNLOAD_DELAY_MS) || 0 : 0
/** `SB_MAP_DOWNLOAD_FAIL=1`: every map check fails (after the delay, if there is one). */
const DEBUG_DOWNLOAD_FAIL = isDev && process.env.SB_MAP_DOWNLOAD_FAIL === '1'

export class MapStore {
  private dirCreated: Promise<string | void | undefined>
  private activeDownloads = new Map<string, Promise<boolean>>()

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
      this.activeDownloads.set(mapHash, this.checkAndDownloadMap(mapHash, mapFormat, mapUrl))
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
      if (DEBUG_DOWNLOAD_DELAY_MS) {
        log.verbose(`Delaying map download by ${DEBUG_DOWNLOAD_DELAY_MS} ms (debug knob)`)
        await new Promise(resolve => setTimeout(resolve, DEBUG_DOWNLOAD_DELAY_MS))
      }
      if (DEBUG_DOWNLOAD_FAIL) {
        throw new Error('Map download failed (debug knob)')
      }

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
      // A download that stops receiving data is given up on, rather than holding the file open
      // (where StarCraft can't read it) and holding every later request for this map until the
      // app restarts.
      const idle = new AbortController()
      let idleTimer: ReturnType<typeof setTimeout> | undefined
      const stillReceiving = () => {
        clearTimeout(idleTimer)
        idleTimer = setTimeout(
          () => idle.abort(new Error(`Map download received nothing for ${DOWNLOAD_IDLE_MS} ms`)),
          DOWNLOAD_IDLE_MS,
        )
      }
      stillReceiving()
      const hasher = new HashThrough()
      hasher.hasher.update(mapFormat)
      try {
        const res = await net.fetch(mapUrl, { signal: idle.signal })
        if (!res.ok) {
          throw new Error(`Failed to download map: ${res.status} ${res.statusText}`)
        }
        if (!res.body) {
          throw new Error(`Failed to download map, response had no body`)
        }

        // NOTE(tec27): The type of `body` doesn't say it has asyncIterator for some reason but it
        // should? Not really sure why the types don't align here
        const doneWriting = pipeline(
          Readable.fromWeb(res.body as any),
          new Transform({
            transform(chunk, _encoding, callback) {
              stillReceiving()
              callback(null, chunk)
            },
          }),
          hasher,
          fs.createWriteStream(mapPath),
          { signal: idle.signal },
        )
        hasher.resume()
        await doneWriting
      } finally {
        clearTimeout(idleTimer)
      }

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
      this.activeDownloads.delete(mapHash)
    }
  }
}
