import * as crypto from 'crypto'
import { Transform, TransformCallback, TransformOptions } from 'stream'

// Transform stream that just passes data through, but hashes it using SHA-256 as it does.
// To get output, use `HashThrough#hashPromise`, which will resolve with the hex version of the
// resulting hash when the stream finishes (or reject on errors).
export default class HashThrough extends Transform {
  readonly hasher: crypto.Hash
  readonly hashPromise: Promise<string>

  constructor(opts?: TransformOptions) {
    super(opts)
    this.hasher = crypto.createHash('sha256')
    this.hashPromise = new Promise((resolve, reject) => {
      this.on('finish', () => resolve(this.hasher.digest('hex'))).on('error', err => reject(err))
    })
  }

  override _transform(chunk: any, enc: BufferEncoding, cb: TransformCallback) {
    this.hasher.update(chunk)

    this.push(chunk)
    cb()
  }
}
