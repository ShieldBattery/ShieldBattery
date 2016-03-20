import fs from 'fs'
import path from 'path'
import mkdirp from 'mkdirp'
import thenify from 'thenify'
import { Map } from 'immutable'
import request from 'request'

const asyncStat = thenify(fs.stat)
const asyncMkdirp = thenify(mkdirp)

export default class MapStore {
  constructor(basePath) {
    this.basePath = basePath
    mkdirp.sync(basePath, 0o777)

    this._activeDownloads = new Map()
  }

  async downloadMap(server, mapHash, mapFormat) {
    if (!this._activeDownloads.has(mapHash)) {
      this._activeDownloads = this._activeDownloads.set(
          mapHash, this._checkAndDownloadMap(server, mapHash, mapFormat))
    }

    return this._activeDownloads.get(mapHash)
  }

  async _checkAndDownloadMap(server, mapHash, mapFormat) {
    const firstByte = mapHash.substr(0, 2)
    const secondByte = mapHash.substr(2, 2)
    const mapPath = path.join(
      this.basePath,
      firstByte,
      secondByte,
      `${mapHash}.${mapFormat}`
    )

    let exists = false
    try {
      await asyncStat(mapPath)
      exists = true
    } catch (ignored) {
      // error just means the file doesn't exist (most likely)
    }

    try {
      if (exists) {
        return true
      }

      await asyncMkdirp(path.dirname(mapPath), 0o777)
      const url = `${server}/maps/${firstByte}/${secondByte}/${mapHash}.${mapFormat}`
      await new Promise((resolve, reject) => {
        const outStream = fs.createWriteStream(mapPath)
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
