import BufferList from 'bl'
import Koa from 'koa'
import { Readable } from 'stream'
import { FileStore } from './store.js'

let store: FileStore | null = null

export function setStore(obj: FileStore) {
  store = obj
}

export function writeFile(filename: string, data: Buffer | BufferList | Readable, options?: any) {
  const stream = Buffer.isBuffer(data) || BufferList.isBufferList(data) ? Readable.from(data) : data

  return store!.write(filename, stream, options)
}

export async function readFile(filename: string, options?: any) {
  return store!.read(filename, options)
}

export async function deleteFile(filename: string, options?: any) {
  return store!.delete(filename, options)
}

export async function deleteFiles(prefix: string, options?: any) {
  return store!.deleteFiles(prefix, options)
}

export function getUrl(filename: string, options?: any) {
  return store!.url(filename, options)
}

export interface GetSignedUrlOptions {
  /** How long the url should be valid for, in seconds. Defaults to `900` (15 minutes). */
  expires?: number
}

export async function getSignedUrl(filename: string, options?: GetSignedUrlOptions) {
  return store!.signedUrl(filename, options)
}

export function addMiddleware(app: Koa) {
  store!.addMiddleware(app)
}
