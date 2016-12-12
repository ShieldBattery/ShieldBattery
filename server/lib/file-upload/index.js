import { Readable } from 'stream'

let store = null

export function setStore(obj) {
  store = obj
}

// Accepts either `Bufffer` or a `Readable` for `data`
export async function writeFile(filename, data) {
  if (Buffer.isBuffer(data)) {
    return store.write(filename, new Readable({
      read() {
        this.push(data)
        this.push(null)
      }
    }))
  } else {
    return store.write(filename, data)
  }
}
