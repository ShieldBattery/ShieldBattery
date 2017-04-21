import fs from 'fs'
import HashThrough from './hash-through'
import { streamEndPromise } from './async/stream-promise'

export default async function getFileHash(filePath) {
  const hasher = new HashThrough()
  const fileStream = fs.createReadStream(filePath)
  const fsPromise = streamEndPromise(fileStream)
  fileStream.pipe(hasher)
  hasher.resume()

  const [hash, ] = await Promise.all([hasher.hashPromise, fsPromise])
  return hash
}
