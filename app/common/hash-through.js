import crypto from 'crypto'
import { Transform } from 'stream'

// Transform stream that just passes data through, but hashes it using SHA-256 as it does.
// To get output, use `HashThrough#hashPromise`, which will resolve with the hex version of the
// resulting hash when the stream finishes (or reject on errors).
export default class HashThrough extends Transform {
  constructor(opts) {
    super(opts)
    this.hasher = crypto.createHash('sha256')
    this.hashPromise = new Promise((resolve, reject) => {
      this.on('finish', () => resolve(this.hasher.digest('hex'))).on('error', err => reject(err))
    })
  }

  _transform(chunk, enc, cb) {
    this.hasher.update(chunk)

    this.push(chunk)
    cb()
  }
}
