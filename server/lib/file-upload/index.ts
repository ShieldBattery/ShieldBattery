import { Readable } from 'stream'
import Koa from 'koa'
import { FileStore } from './store'

let store: FileStore | null = null

export function setStore(obj: FileStore) {
  store = obj
}

export function writeFile(filename: string, data: Buffer | Readable, options: any) {
  const stream = Buffer.isBuffer(data)
    ? new Readable({
        read() {
          this.push(data)
          this.push(null)
        },
      })
    : data

  return store!.write(filename, stream, options)
}

export async function readFile(filename: string, options: any) {
  return store!.read(filename, options)
}

export async function deleteFile(filename: string, options: any) {
  return store!.delete(filename, options)
}

export async function deleteFiles(prefix: string, options: any) {
  return store!.deleteFiles(prefix, options)
}

export async function getUrl(filename: string, options: any) {
  return store!.url(filename, options)
}

export function addMiddleware(app: Koa) {
  store!.addMiddleware(app)
}
