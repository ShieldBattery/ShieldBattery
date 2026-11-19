import { TranslationLanguage } from './i18n'

/**
 * A hash of the contents of each language's client translation file, keyed by language. A language
 * is missing if the server couldn't hash its file.
 */
export type TranslationHashes = Partial<Record<TranslationLanguage, string>>

/**
 * Config that the client requests from the server when it launches in case of an Electron app, or
 * injected into the HTML document for the web version.
 */
export interface ServerConfig {
  /** URL to the server's public directory containing static content. */
  publicAssetsUrl: string
  /** Network origin for any GraphQL requests. */
  graphqlOrigin: string
  /**
   * Hashes of the translation files this server has published, which clients use as the cache key
   * when requesting them. Optional because a client that can't reach the server runs on a stored or
   * built-in config, which can lack this.
   */
  translationHashes?: TranslationHashes
}
