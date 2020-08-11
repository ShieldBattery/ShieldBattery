import fs from 'fs'
import koaMount from 'koa-mount'
import koaStatic from 'koa-static'
import log from '../logging/logger.js'
import path from 'path'
import thenify from 'thenify'
import util from 'util'

import { FILE_MAX_AGE_MS } from './index.js'

const access = thenify(fs.access)
const mkdir = thenify(fs.mkdir)
const unlinkAsync = util.promisify(fs.unlink)

async function createDirectory(path) {
  try {
    await access(path)
  } catch (_) {
    await mkdir(path)
  }
}

async function createDirTree(dir) {
  const segments = dir.split(path.sep)
  let currentDir = ''
  for (const segment of segments) {
    currentDir += segment + path.sep
    await createDirectory(currentDir)
  }
}

export default class LocalFsStore {
  constructor({ path }) {
    this.path = path
  }

  _getFullPath(filename) {
    const normalized = path.normalize(filename)
    if (path.isAbsolute(normalized) || normalized[0] === '.') {
      throw new Error('Invalid directory')
    }
    return path.join(this.path, normalized)
  }

  async write(filename, stream) {
    const full = this._getFullPath(filename)
    await createDirTree(path.dirname(full))
    const out = fs.createWriteStream(full)
    stream.pipe(out)
    return new Promise((resolve, reject) => {
      out.on('finish', resolve)
      stream.on('error', reject)
      out.on('error', reject)
    })
  }

  async delete(filename) {
    const full = this._getFullPath(filename)
    try {
      // TODO(2Pac): Delete the directory tree as well, if it's empty
      await unlinkAsync(full)
    } catch (err) {
      // File most likely doesn't exist so there's nothing to delete; just log the error and move on
      log.error({ err }, 'error deleting the file')
    }
  }

  async url(filename) {
    const full = this._getFullPath(filename)
    try {
      await access(full)
      return `${process.env.SB_CANONICAL_HOST}/files/${path.posix.normalize(filename)}`
    } catch (_) {
      return null
    }
  }

  addMiddleware(app) {
    app.use(koaMount('/files', koaStatic(this.path, { maxage: FILE_MAX_AGE_MS })))
  }
}
