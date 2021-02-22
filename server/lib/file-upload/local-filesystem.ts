import { createWriteStream } from 'fs'
import { access, mkdir, readFile, unlink } from 'fs/promises'
import Koa from 'koa'
import koaMount from 'koa-mount'
import koaStatic from 'koa-static'
import path from 'path'
import rimraf from 'rimraf'
import { Readable } from 'stream'
import util from 'util'
import { FileStore } from './store'

// How long browsers can cache resources for (in milliseconds). These resources should all be pretty
// static, so this can be a long time
export const FILE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000

const rimrafAsync = util.promisify(rimraf)

export default class LocalFsStore implements FileStore {
  readonly path: string

  constructor({ path }: { path: string }) {
    this.path = path
  }

  private getFullPath(filename: string) {
    const normalized = path.normalize(filename)
    if (path.isAbsolute(normalized) || normalized[0] === '.') {
      throw new Error('Invalid directory')
    }
    return path.join(this.path, normalized)
  }

  async write(filename: string, stream: Readable) {
    const full = this.getFullPath(filename)
    await mkdir(path.dirname(full), { recursive: true })
    const out = createWriteStream(full)
    stream.pipe(out)
    return new Promise((resolve, reject) => {
      out.on('finish', resolve)
      stream.on('error', reject)
      out.on('error', reject)
    })
  }

  async read(filename: string, options: any): Promise<Buffer> {
    const full = this.getFullPath(filename)
    return readFile(full)
  }

  async delete(filename: string) {
    const full = this.getFullPath(filename)
    await unlink(full)
  }

  async deleteFiles(prefix: string) {
    const full = this.getFullPath(prefix)
    await rimrafAsync(full)
  }

  async url(filename: string, signUrl: boolean) {
    const full = this.getFullPath(filename)
    // NOTE(tec27): This just simulates the cache-busting properties of having a signed URL in
    // a dev environment, it provides no actual signature protection :)
    const signature = signUrl ? `?${Date.now()}` : ''
    try {
      await access(full)
      return `${process.env.SB_CANONICAL_HOST}/files/${path.posix.normalize(filename)}${signature}`
    } catch (_) {
      return null
    }
  }

  addMiddleware(app: Koa) {
    app.use(koaMount('/files', koaStatic(this.path, { maxage: FILE_MAX_AGE_MS })))
  }
}
