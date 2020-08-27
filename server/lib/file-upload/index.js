import { Readable } from 'stream'

let store = null

export function setStore(obj) {
  store = obj
}

// Accepts either `Buffer` or a `Readable` for `data`
export function writeFile(filename, data, options) {
  const stream = Buffer.isBuffer(data)
    ? new Readable({
        read() {
          this.push(data)
          this.push(null)
        },
      })
    : data

  return store.write(filename, stream, options)
}

export function deleteFile(filename, options) {
  return store.delete(filename, options)
}

export function deleteFiles(prefix, options) {
  return store.deleteFiles(prefix, options)
}

export function getUrl(filename, options) {
  return store.url(filename, options)
}

export function addMiddleware(app) {
  if (store.addMiddleware) {
    store.addMiddleware(app)
  }
}
