import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import createScmExtractor from 'scm-extractor'

/** Hashes the scenario stored inside a library SCM/SCX map for exact replay-map matching. */
export async function scenarioHashForMap(bytes: Buffer): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of Readable.from([bytes]).pipe(createScmExtractor())) {
    hash.update(chunk)
  }
  return hash.digest('hex')
}
