import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { Transform } from 'stream'
import mkdirp from 'mkdirp'
import thenify from 'thenify'
import { Map } from 'immutable'
import request from 'request'
import log from './logger'

const asyncStat = thenify(fs.stat)
const asyncMkdirp = thenify(mkdirp)

class HashThrough extends Transform {
  constructor(opts) {
    super(opts)
    this.hasher = crypto.createHash('sha256')
    this.hashPromise = new Promise((resolve, reject) => {
      this.on('finish', () => resolve(this.hasher.digest('hex')))
        .on('error', err => reject(err))
    })
  }

  _transform(chunk, enc, cb) {
    this.hasher.update(chunk)

    this.push(chunk)
    cb()
  }
}

export default class MapStore {
  constructor(basePath) {
    this.basePath = basePath
    mkdirp.sync(basePath, 0o777)

    this._activeDownloads = new Map()
  }

  getPath(mapHash, mapFormat) {
    const b64 = new Buffer(mapHash, 'hex').toString('base64')
    // Goal of dirs is twofold:
    // - Avoid a huge number of files in a single directory
    // - Get the resulting filename under 32 characters (necessary because BW checks this =/)
    const firstDir = mapHash.substr(0, 2)
    const secondDir = b64
    return path.join(
      this.basePath,
      firstDir,
      secondDir,
      `map.${mapFormat}`
    )
  }

  async downloadMap(server, mapHash, mapFormat) {
    if (!this._activeDownloads.has(mapHash)) {
      this._activeDownloads = this._activeDownloads.set(
          mapHash, this._checkAndDownloadMap(server, mapHash, mapFormat))
    }

    return this._activeDownloads.get(mapHash)
  }

  async _checkAndDownloadMap(server, mapHash, mapFormat) {
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

      await asyncMkdirp(path.dirname(mapPath), 0o777)
      const firstByte = mapHash.substr(0, 2)
      const secondByte = mapHash.substr(2, 2)
      const url = `${server}/maps/${firstByte}/${secondByte}/${mapHash}.${mapFormat}`
      await new Promise((resolve, reject) => {
        const outStream = fs.createWriteStream(mapPath, { mode: 0o777 })
        outStream.on('error', reject)
          .on('finish', resolve)
        request.get(url)
          .on('error', reject)
          .pipe(outStream)
      })

      return true
    } finally {
      this._activeDownloads = this._activeDownloads.delete(mapHash)
    }
  }
}
