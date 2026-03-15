import { createWriteStream } from 'fs'
import { mkdir, readFile, unlink } from 'fs/promises'
import Koa from 'koa'
import koaMount from 'koa-mount'
import koaStatic from 'koa-static'
import path from 'path'
import { rimraf } from 'rimraf'
import { Readable } from 'stream'
import { FileStore, GetSignedUrlOptions } from './store'

// How long browsers can cache resources for (in milliseconds). These resources should all be pretty
// static, so this can be a long time
export const FILE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000

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

  async write(filename: string, stream: Readable): Promise<void> {
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

  async read(filename: string, options?: any): Promise<Buffer> {
    const full = this.getFullPath(filename)
    return readFile(full)
  }

  async delete(filename: string) {
    const full = this.getFullPath(filename)
    await unlink(full)
  }

  async deleteFiles(prefix: string) {
    const full = this.getFullPath(prefix)
    await rimraf(full)
  }

  url(filename: string) {
    return `${process.env.SB_CANONICAL_HOST}/files/${path.posix.normalize(filename)}`
  }

  async signedUrl(filename: string, options: GetSignedUrlOptions = {}): Promise<string> {
    const params = new URLSearchParams()
    // NOTE(tec27): This just simulates the cache-busting properties of having a signed URL in
    // a dev environment, it provides no actual signature protection :)
    params.set('signature', String(Date.now()))
    if (options.expires) {
      params.set('expires', String(options.expires))
    }
    if (options.contentType) {
      params.set('response-content-type', options.contentType)
    }
    if (options.contentDisposition) {
      params.set('response-content-disposition', options.contentDisposition)
    }
    return (
      `${process.env.SB_CANONICAL_HOST}/files/` +
      `${path.posix.normalize(filename)}?${params.toString()}`
    )
  }

  addMiddleware(app: Koa) {
    app.use(koaMount('/files', createFileMiddleware(this.path)))
  }
}

/**
 * Re-encodes a Content-Disposition header value so that non-ASCII filenames use the RFC 5987
 * `filename*=UTF-8''...` syntax, which is required since HTTP headers only allow ASCII characters.
 */
function encodeContentDisposition(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (!/[^\x20-\x7E]/.test(value)) {
    return value
  }

  const filenameMatch = value.match(/filename="(.+?)"/)
  if (!filenameMatch) {
    return value
  }

  const filename = filenameMatch[1]
  const encoded = encodeURIComponent(filename)
  // Replace the plain filename with an ASCII fallback + the RFC 5987 encoded version
  const asciiFilename = filename.replace(/[^\x20-\x7E]/g, '_')
  return value.replace(filenameMatch[0], `filename="${asciiFilename}"; filename*=UTF-8''${encoded}`)
}

function createFileMiddleware(path: string) {
  const staticMiddleware = koaStatic(path, { maxage: FILE_MAX_AGE_MS })

  return async (ctx: Koa.Context, next: Koa.Next) => {
    const responseContentType =
      typeof ctx.query['response-content-type'] === 'string'
        ? ctx.query['response-content-type']
        : undefined
    const responseContentDisposition =
      typeof ctx.query['response-content-disposition'] === 'string'
        ? ctx.query['response-content-disposition']
        : undefined

    const result = await staticMiddleware(ctx, next)

    if (responseContentType && /^[\w-]+\/[-+.\w]+$/.test(responseContentType)) {
      ctx.set('Content-Type', responseContentType)
    }
    if (responseContentDisposition) {
      ctx.set('Content-Disposition', encodeContentDisposition(responseContentDisposition))
    }

    return result
  }
}
