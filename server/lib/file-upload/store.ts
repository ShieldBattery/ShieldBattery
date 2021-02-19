import Koa from 'koa'
import { Readable } from 'stream'

// TODO(tec27): Type options better
/** A generic file store type, meant to allow us to swap stores between dev/prod environments. */
export interface FileStore {
  write(filename: string, data: Readable, options: any): Promise<any>
  read(filename: string, options: any): Promise<Buffer>
  delete(filename: string, options: any): Promise<any>
  deleteFiles(prefix: string, options: any): Promise<any>
  url(filename: string, signUrl?: boolean, options?: any): Promise<string | null>

  addMiddleware(app: Koa): void
}
