import crypto from 'crypto'
import { Transform } from 'stream'

// Pass-through transform stream which hashes the data passed to it.
export default class HashThrough extends Transform {
  constructor(opts) {
    super(opts)
    this.hasher = crypto.createHash('sha256')
    this.hashPromise = new Promise((resolve, reject) => {
      this.on('finish', () => resolve(this.hasher.digest('hex')))
        .on('error', err => reject(err))
    })
  }

  _transform(chunk, enc, cb) {
    this.hasher.update(chunk)

    this.push(chunk)
    cb()
  }
}
