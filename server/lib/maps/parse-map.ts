import Chk from 'bw-chk'
import fs from 'fs'
import createScmExtractor from 'scm-extractor'
import { Duplex } from 'stream'
import HashThrough from '../../../common/hash-through'
import { MapExtension } from '../../../common/maps'

// bw-chk's shipped types omit `createStream`, a static factory the package exports at runtime
// (it pipes a CHK-containing stream into a parsed `Chk` instance, invoking the callback once
// parsing finishes or fails).
interface ChkStatic {
  createStream(callback: (err: Error | null, chk?: Chk) => void): Duplex
}

export interface ParsedMap {
  map: Chk
  hash: string
}

export async function parseAndHashMap(
  filePath: string,
  extension: MapExtension,
): Promise<ParsedMap> {
  const hasher = new HashThrough()
  hasher.hasher.update(extension.toLowerCase())

  const map = await new Promise<Chk>((resolve, reject) => {
    const stream = fs.createReadStream(filePath)
    const scmExtractor = createScmExtractor()
    stream.on('error', e => reject(e))
    scmExtractor.on('error', e => reject(e))
    stream
      .pipe(hasher)
      .pipe(scmExtractor)
      .pipe(
        (Chk as unknown as ChkStatic).createStream((err, chk) => {
          if (err) {
            reject(err)
          } else {
            resolve(chk!)
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
