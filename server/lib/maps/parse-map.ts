import ChkModule from 'bw-chk'
import * as fs from 'node:fs'
import { pipeline } from 'node:stream/promises'
import createScmExtractor from 'scm-extractor'
import HashThrough from '../../../common/hash-through.js'

type Chk = ChkModule.default

export async function parseAndHashMap(
  filePath: string,
  extension: string,
): Promise<{ map: Chk; hash: string }> {
  const hasher = new HashThrough()
  hasher.hasher.update(extension.toLowerCase())

  const stream = fs.createReadStream(filePath)
  const scmExtractor = createScmExtractor()
  const map = await new Promise<Chk>((resolve, reject) => {
    pipeline(
      stream,
      hasher,
      scmExtractor,
      (ChkModule.default as any).createStream((err: Error | null, chk: Chk) => {
        if (err) {
          reject(err)
        } else {
          resolve(chk)
        }
      }),
    ).catch(reject)
  })

  const hash = await hasher.hashPromise
  return {
    map,
    hash,
  }
}
