import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { ALL_TRANSLATION_LANGUAGES, TranslationNamespace } from '../../../common/i18n'
import { TranslationHashes } from '../../../common/server-config'
import logger from '../logging/logger'

const LOCALES_PATH = path.join(__dirname, '..', '..', 'public', 'locales')

/**
 * Hashes the contents of each language's client translation file, for clients to use as the cache
 * key when requesting it.
 *
 * These must be the same files the deployment publishes as public assets, and must only be reported
 * to clients once that publish has completed: a client that requests a key before its file is
 * published gets the file it replaces, and the CDN and the client both keep that under the new key.
 *
 * A language whose file can't be read is left out, and clients fall back to a cache key of their
 * own for it.
 */
export function computeTranslationHashes(localesPath: string = LOCALES_PATH): TranslationHashes {
  const hashes: TranslationHashes = {}
  for (const language of ALL_TRANSLATION_LANGUAGES) {
    const hash = hashFile(path.join(localesPath, language, `${TranslationNamespace.Global}.json`))
    if (hash) {
      hashes[language] = hash
    }
  }
  return hashes
}

function hashFile(filePath: string): string | undefined {
  let contents: Buffer
  try {
    contents = readFileSync(filePath)
  } catch (err) {
    logger.error({ err }, `couldn't read translation file to hash it: ${filePath}`)
    return undefined
  }

  // A cache key rather than an integrity check, so a short prefix is plenty
  return createHash('sha256').update(contents).digest('hex').slice(0, 16)
}
