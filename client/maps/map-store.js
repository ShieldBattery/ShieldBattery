import fs from 'fs'
import path from 'path'
import mkdirp from 'mkdirp'
import thenify from 'thenify'
import { Map } from 'immutable'
import request from 'request'
import HashThrough from '../../app/common/hash-through'
import log from '../logging/logger'

const asyncStat = thenify(fs.stat)

export default class MapStore {
  constructor(basePath) {
    this.basePath = basePath
    this._dirCreated = mkdirp(basePath)

    this._activeDownloads = new Map()
  }

  getPath(mapHash, mapFormat) {
    const b64 = Buffer.from(mapHash, 'hex').toString('base64')
    // Goal of dirs is twofold:
    // - Avoid a huge number of files in a single directory
    // - Get the resulting filename under 32 characters (necessary because BW checks this =/)
    const firstDir = mapHash.substr(0, 2)
    const secondDir = b64
    return path.join(this.basePath, firstDir, secondDir, `map.${mapFormat}`)
  }

  async downloadMap(mapHash, mapFormat, mapUrl) {
    if (!this._activeDownloads.has(mapHash)) {
      this._activeDownloads = this._activeDownloads.set(
        mapHash,
        this._checkAndDownloadMap(mapHash, mapFormat, mapUrl),
      )
    }

    return this._activeDownloads.get(mapHash)
  }

  async _checkAndDownloadMap(mapHash, mapFormat, mapUrl) {
    await this._dirCreated
    const mapPath = this.getPath(mapHash, mapFormat)

    let exists = false
    try {
      await asyncStat(mapPath)
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
        request.get(mapUrl).on('error', reject).pipe(outStream)
      })

      return true
    } finally {
      this._activeDownloads = this._activeDownloads.delete(mapHash)
    }
  }
}
