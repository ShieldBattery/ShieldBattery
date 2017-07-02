import { Readable } from 'stream'

let store = null

export function setStore(obj) {
  store = obj
}

// Accepts either `Buffer` or a `Readable` for `data`
export async function writeFile(filename, data) {
  if (Buffer.isBuffer(data)) {
    return store.write(
      filename,
      new Readable({
        read() {
          this.push(data)
          this.push(null)
        },
      }),
    )
  } else {
    return store.write(filename, data)
  }
}

export async function getUrl(filename) {
  return store.url(filename)
}

export function addMiddleware(app) {
  if (store.addMiddleware) {
    store.addMiddleware(app)
  }
}
