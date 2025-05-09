import Koa from 'koa'
import { Readable } from 'stream'

export interface GetSignedUrlOptions {
  /** How long the url should be valid for, in seconds. Defaults to `900` (15 minutes). */
  expires?: number
}

// TODO(tec27): Type options better
/** A generic file store type, meant to allow us to swap stores between dev/prod environments. */
export interface FileStore {
  write(filename: string, data: Readable, options: any): Promise<any>
  read(filename: string, options: any): Promise<Buffer>
  delete(filename: string, options: any): Promise<any>
  deleteFiles(prefix: string, options: any): Promise<any>
  url(filename: string): string
  signedUrl(filename: string, options?: GetSignedUrlOptions): Promise<string>

  addMiddleware(app: Koa): void
}
