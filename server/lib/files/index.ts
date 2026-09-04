import Koa from 'koa'
import { Readable } from 'stream'
import { FileStore, GetSignedUrlOptions, StoredFileStream } from './store'

let store: FileStore | null = null

export function setStore(obj: FileStore) {
  store = obj
}

export function writeFile(filename: string, data: Buffer | Readable, options?: any) {
  const stream = Buffer.isBuffer(data) ? Readable.from(data) : data

  return store!.write(filename, stream, options)
}

export async function readFile(filename: string, options?: any) {
  return store!.read(filename, options)
}

/**
 * Opens a stored file for streaming (e.g. to hand a large file to a response body without holding
 * all of it in memory). Rejects if the file can't be opened.
 */
export async function readFileStream(filename: string): Promise<StoredFileStream> {
  return store!.readStream(filename)
}

export async function deleteFile(filename: string, options?: any) {
  return store!.delete(filename, options)
}

export async function deleteFiles(prefix: string, options?: any) {
  return store!.deleteFiles(prefix, options)
}

export function getUrl(filename: string) {
  return store!.url(filename)
}

export async function getSignedUrl(filename: string, options?: GetSignedUrlOptions) {
  return store!.signedUrl(filename, options)
}

export function addMiddleware(app: Koa) {
  store!.addMiddleware(app)
}
