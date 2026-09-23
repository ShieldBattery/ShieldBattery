/**
 * What the app remembers about this PC's bot library: which catalog releases are installed, which
 * local builds the user added, and which Java runtime each bot was pinned to. Records here name
 * files the app launches, so they are re-checked on load exactly like a freshly downloaded catalog
 * would be; a record that no longer makes sense is dropped rather than trusted.
 */

import {
  BotKey,
  CachedBotCatalog,
  InstalledBotRelease,
  LocalBuildBot,
} from '../../common/bots/bot-library'
import { openCatalogDocument, validateBotIdentity, validateBotPackage } from './catalog'
import { CatalogTrust } from './catalog-envelope'
import { readJsonFile, writeJsonFileAtomic } from './json-file'
import { defaultLocalBuildFormats, validateLocalBuildSpec } from './local-builds'

export interface BotLibraryData {
  installed: InstalledBotRelease[]
  localBuilds: LocalBuildBot[]
  /** `java.exe` the user picked for a specific bot, overriding detection. */
  javaOverrides: Record<BotKey, string>
}

export interface LoadedLibraryData {
  data: BotLibraryData
  /** Records that failed their checks and were left out, with a reason each. */
  dropped: string[]
}

export function emptyLibraryData(): BotLibraryData {
  return { installed: [], localBuilds: [], javaOverrides: {} }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validateInstalled(value: unknown): InstalledBotRelease {
  if (!isRecord(value)) {
    throw new Error('is not an object')
  }
  const bot = validateBotIdentity(value.bot, 'bot')
  const pkg = validateBotPackage(value.package, 'package', bot.id)
  if (value.botId !== bot.id) {
    throw new Error('names a different bot than its identity')
  }
  if (value.releaseId !== pkg.releaseId) {
    throw new Error('names a different release than its package')
  }
  if (typeof value.digest !== 'string' || !/^[a-f0-9]{64}$/.test(value.digest)) {
    throw new Error('has no archive digest')
  }
  if (typeof value.installedAt !== 'number' || !Number.isFinite(value.installedAt)) {
    throw new Error('has no install time')
  }
  if (typeof value.sizeBytes !== 'number' || !Number.isFinite(value.sizeBytes)) {
    throw new Error('has no size')
  }
  return {
    botId: bot.id,
    releaseId: pkg.releaseId,
    version: pkg.version,
    installedAt: value.installedAt,
    sizeBytes: value.sizeBytes,
    digest: value.digest,
    bot,
    package: pkg,
  }
}

function validateLocalBuild(value: unknown): LocalBuildBot {
  if (!isRecord(value)) {
    throw new Error('is not an object')
  }
  if (typeof value.key !== 'string' || !value.key.startsWith('local:')) {
    throw new Error('has no local build key')
  }
  const spec = validateLocalBuildSpec(value)
  return {
    key: value.key,
    ...spec,
    formats: Array.isArray(value.formats)
      ? (value.formats as LocalBuildBot['formats'])
      : defaultLocalBuildFormats(),
    learning: isRecord(value.learning)
      ? (value.learning as unknown as LocalBuildBot['learning'])
      : { mode: 'unknown', notes: '' },
    addedAt: typeof value.addedAt === 'number' ? value.addedAt : Date.now(),
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : Date.now(),
  }
}

/**
 * Reads the library file. A file that can't be read at all comes back empty (and is left on disk
 * untouched until the next successful save); individual records that fail their checks are
 * dropped and named in `dropped`.
 */
export async function loadLibraryData(filePath: string): Promise<LoadedLibraryData> {
  const dropped: string[] = []
  let value: unknown
  try {
    value = await readJsonFile(filePath)
  } catch (err) {
    return { data: emptyLibraryData(), dropped: [`library file unreadable: ${String(err)}`] }
  }
  if (value === undefined) {
    return { data: emptyLibraryData(), dropped }
  }
  if (!isRecord(value)) {
    return { data: emptyLibraryData(), dropped: ['library file is not an object'] }
  }

  const data = emptyLibraryData()
  for (const item of Array.isArray(value.installed) ? value.installed : []) {
    try {
      data.installed.push(validateInstalled(item))
    } catch (err) {
      dropped.push(`installed bot: ${(err as Error).message}`)
    }
  }
  for (const item of Array.isArray(value.localBuilds) ? value.localBuilds : []) {
    try {
      data.localBuilds.push(validateLocalBuild(item))
    } catch (err) {
      dropped.push(`local build: ${(err as Error).message}`)
    }
  }
  if (isRecord(value.javaOverrides)) {
    for (const [key, javaPath] of Object.entries(value.javaOverrides)) {
      if (typeof javaPath === 'string' && javaPath.length) {
        data.javaOverrides[key] = javaPath
      }
    }
  }
  return { data, dropped }
}

export async function saveLibraryData(filePath: string, data: BotLibraryData): Promise<void> {
  await writeJsonFileAtomic(filePath, data)
}

/** The cache file's layout. Bumped when what the file holds changes shape. */
const CATALOG_CACHE_VERSION = 2

export interface CatalogCacheEntry {
  fetchedAt: number
  url: string
  /** The catalog document exactly as the server sent it, signature included. */
  document: unknown
}

/**
 * Reads the cached catalog. The file holds the document exactly as it was served, so it is opened
 * the same way a fresh download is, signature check included: a file on disk is not evidence of
 * what the CDN served, and the signature is what makes the cache worth acting on.
 */
export async function loadCachedCatalog(
  filePath: string,
  trust: CatalogTrust,
): Promise<CachedBotCatalog | undefined> {
  const value = await readJsonFile(filePath)
  if (value === undefined) {
    return undefined
  }
  if (
    !isRecord(value) ||
    value.schemaVersion !== CATALOG_CACHE_VERSION ||
    typeof value.url !== 'string' ||
    value.document === undefined
  ) {
    throw new Error('The cached bot catalog is in a layout this app does not read')
  }
  const fetchedAt =
    typeof value.fetchedAt === 'number' && Number.isFinite(value.fetchedAt) ? value.fetchedAt : 0
  const catalog = openCatalogDocument(value.document, { url: value.url, trust })
  return { revision: catalog.revision, fetchedAt, url: value.url, bots: catalog.bots }
}

export async function saveCachedCatalog(filePath: string, entry: CatalogCacheEntry): Promise<void> {
  await writeJsonFileAtomic(filePath, { schemaVersion: CATALOG_CACHE_VERSION, ...entry })
}
