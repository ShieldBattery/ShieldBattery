import Chk from 'bw-chk'
import fs from 'fs'
import createScmExtractor from 'scm-extractor'
import HashThrough from '../../../common/hash-through.js'

export async function parseAndHashMap(filePath, extension) {
  const hasher = new HashThrough()
  hasher.hasher.update(extension.toLowerCase())

  const map = await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath)
    const scmExtractor = createScmExtractor()
    stream.on('error', e => reject(e))
    scmExtractor.on('error', e => reject(e))
    stream
      .pipe(hasher)
      .pipe(scmExtractor)
      .pipe(
        Chk.createStream((err, chk) => {
          if (err) {
            reject(err)
          } else {
            resolve(chk)
          }
        }),
      )
  })
  const hash = await hasher.hashPromise
  return {
    map,
    hash,
  }
}
