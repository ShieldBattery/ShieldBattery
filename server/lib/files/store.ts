import Koa from 'koa'
import { Readable } from 'stream'

export interface GetSignedUrlOptions {
  /** How long the url should be valid for, in seconds. Defaults to `900` (15 minutes). */
  expires?: number
  /** The MIME type that will be given for the file in the response. */
  contentType?: string
  /**
   * The Content-Disposition header value that will be used for the response. This can be used to
   * trigger downloads with specific filenames by setting it to `attachment; filename="..."`.
   */
  contentDisposition?: string
}

// TODO(tec27): Type options better
/** A generic file store type, meant to allow us to swap stores between dev/prod environments. */
/** A stored file opened for streaming, with its size as reported by the store (when it is). */
export interface StoredFileStream {
  stream: Readable
  /** Size of the file in bytes, if the store reports one. */
  size?: number
}

export interface FileStore {
  write(filename: string, data: Readable, options: any): Promise<any>
  read(filename: string, options: any): Promise<Buffer>
  /**
   * Opens the file for streaming. Rejects (rather than erroring on the stream) if the file can't be
   * opened, e.g. because it doesn't exist.
   */
  readStream(filename: string): Promise<StoredFileStream>
  delete(filename: string, options: any): Promise<any>
  deleteFiles(prefix: string, options: any): Promise<any>
  url(filename: string): string
  signedUrl(filename: string, options?: GetSignedUrlOptions): Promise<string>

  addMiddleware(app: Koa): void
}
