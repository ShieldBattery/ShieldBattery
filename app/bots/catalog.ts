/**
 * Fetching and validating the published bot catalog. Nothing here trusts the document it was
 * given: a catalog names files the app downloads, extracts and executes, so every field the rest
 * of the app reads is checked structurally first, and a document that fails any check is discarded
 * whole rather than merged into what is already cached.
 */

import {
  ALL_BOT_RACE_NAMES,
  BOT_CATALOG_SCHEMA_VERSION,
  BotArchitecture,
  BotCatalog,
  BotCatalogEntry,
  BotCatalogRelease,
  BotEligibility,
  BotEligibilityStatus,
  BotFormatId,
  BotFormatSupport,
  BotLearningMode,
  BotProfile,
  BotRaceName,
  BotRandomRaceSupport,
  BotRuntime,
} from '../../common/bots/bot-catalog'
import { CatalogTrust, looksLikeEnvelope, openCatalogEnvelope } from './catalog-envelope'
import { isSafePackageRelativePath } from './zip-safety'

export const STAGING_CATALOG_URL =
  'https://staging-cdn.shieldbattery.net/robotics-facility/catalog.json'
export const PRODUCTION_CATALOG_URL = 'https://cdn.shieldbattery.net/robotics-facility/catalog.json'

/** How old a cached catalog may be before opening the library refreshes it in the background. */
export const CATALOG_STALE_MS = 6 * 60 * 60 * 1000

const CATALOG_TIMEOUT_MS = 15_000
const MAX_CATALOG_BYTES = 4 * 1024 * 1024

/** Hosts an `http:` catalog override may point at, since a plaintext CDN URL never can be. */
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1'])

const ID_PATTERN = /^[a-z][a-z0-9-]*$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/

const FORMAT_IDS = new Set<BotFormatId>(['one-v-one', 'teams', 'free-for-all'])
const FORMAT_SUPPORTS = new Set<BotFormatSupport>([
  'verified',
  'experimental',
  'incompatible',
  'unverified',
])
const RANDOM_RACE_SUPPORTS = new Set<BotRandomRaceSupport>([
  'supported',
  'unsupported',
  'unverified',
])
const LEARNING_MODES = new Set<BotLearningMode>(['persistent', 'none', 'unknown'])
const ARCHITECTURES = new Set<BotArchitecture>(['x86', 'x86_64'])
const RACE_NAMES = new Set<BotRaceName>(ALL_BOT_RACE_NAMES)
const ELIGIBILITY_STATUSES = new Set<BotEligibilityStatus>([
  'unreviewed',
  'approved',
  'restricted',
  'denied',
])
const REVIEW_STATUSES = new Set(['pending', 'approved', 'rejected'])

/**
 * Picks the catalog URL for this build. An override is only honored when it is `https:`, or
 * `http:` pointed at this machine (the shape a locally served development catalog takes).
 */
export function resolveCatalogUrl({
  override,
  isDev,
}: {
  override?: string
  isDev: boolean
}): string {
  const fallback = isDev ? STAGING_CATALOG_URL : PRODUCTION_CATALOG_URL
  if (!override) {
    return fallback
  }

  let parsed: URL
  try {
    parsed = new URL(override)
  } catch {
    return fallback
  }
  if (parsed.protocol === 'https:') {
    return parsed.href
  }
  if (parsed.protocol === 'http:' && LOCAL_HOSTNAMES.has(parsed.hostname)) {
    return parsed.href
  }
  return fallback
}

/**
 * Whether a cached catalog belongs to the URL this build reads from. Caches are never mixed
 * between channels: a staging catalog's releases have nothing to do with production's.
 */
export function isCachedCatalogUsable(
  cached: { url: string } | undefined,
  catalogUrl: string,
): boolean {
  return !!cached && cached.url === catalogUrl
}

/**
 * Whether a freshly downloaded catalog may replace what is cached. Revisions only ever increase,
 * so a lower one means a stale copy (an edge cache, or a rollback that isn't published yet) and
 * the cache is kept.
 */
export function canReplaceCachedCatalog(
  cached: { url: string; revision: number } | undefined,
  catalogUrl: string,
  revision: number,
): boolean {
  if (!isCachedCatalogUsable(cached, catalogUrl)) {
    return true
  }
  return revision >= cached!.revision
}

function fail(where: string, message: string): never {
  throw new Error(`${where} ${message}`)
}

function asRecord(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(where, 'is not an object')
  }
  return value as Record<string, unknown>
}

function asArray(value: unknown, where: string): unknown[] {
  if (!Array.isArray(value)) {
    fail(where, 'is not an array')
  }
  return value
}

function asString(value: unknown, where: string): string {
  if (typeof value !== 'string') {
    fail(where, 'is not a string')
  }
  return value
}

function asNonEmptyString(value: unknown, where: string): string {
  const str = asString(value, where)
  if (str.length === 0) {
    fail(where, 'is empty')
  }
  return str
}

function asStringArray(value: unknown, where: string): string[] {
  return asArray(value, where).map((item, i) => asString(item, `${where}[${i}]`))
}

function asFiniteNumber(value: unknown, where: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(where, 'is not a number')
  }
  return value
}

function asPositiveInt(value: unknown, where: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    fail(where, 'is not a positive integer')
  }
  return value
}

function asPackagePath(value: unknown, where: string): string {
  const str = asNonEmptyString(value, where)
  if (!isSafePackageRelativePath(str)) {
    fail(where, 'is not a path inside the package')
  }
  return str
}

function asHash(value: unknown, where: string): string {
  const str = asString(value, where)
  if (!SHA256_PATTERN.test(str)) {
    fail(where, 'is not a SHA-256 digest')
  }
  return str
}

function asEnum<T extends string>(value: unknown, where: string, allowed: ReadonlySet<T>): T {
  const str = asString(value, where)
  if (!allowed.has(str as T)) {
    fail(where, `is not one of: ${Array.from(allowed).join(', ')}`)
  }
  return str as T
}

function validateRuntime(value: unknown, where: string): BotRuntime {
  const runtime = asRecord(value, where)
  if (runtime.kind === 'native') {
    return { kind: 'native' }
  }
  if (runtime.kind === 'java') {
    const jvmArguments =
      runtime.jvmArguments === undefined
        ? undefined
        : asStringArray(runtime.jvmArguments, where + '.jvmArguments')
    return {
      kind: 'java',
      major: asPositiveInt(runtime.major, `${where}.major`),
      architecture: asEnum(runtime.architecture, `${where}.architecture`, ARCHITECTURES),
      ...(jvmArguments === undefined ? {} : { jvmArguments }),
    }
  }
  return fail(`${where}.kind`, 'is not a known runtime')
}

function validateProfile(value: unknown, where: string): BotProfile {
  const profile = asRecord(value, where)
  const races = asArray(profile.selectableRaces, `${where}.selectableRaces`)
  if (races.length === 0) {
    fail(`${where}.selectableRaces`, 'is empty')
  }

  const learning = asRecord(profile.learning, `${where}.learning`)
  return {
    selectableRaces: races.map((race, i) =>
      asEnum(race, `${where}.selectableRaces[${i}]`, RACE_NAMES),
    ),
    randomRace: asEnum(profile.randomRace, `${where}.randomRace`, RANDOM_RACE_SUPPORTS),
    formats: asArray(profile.formats, `${where}.formats`).map((item, i) => {
      const format = asRecord(item, `${where}.formats[${i}]`)
      return {
        id: asEnum(format.id, `${where}.formats[${i}].id`, FORMAT_IDS),
        support: asEnum(format.support, `${where}.formats[${i}].support`, FORMAT_SUPPORTS),
        notes: asString(format.notes, `${where}.formats[${i}].notes`),
      }
    }),
    mapConstraints: asStringArray(profile.mapConstraints, `${where}.mapConstraints`),
    learning: {
      mode: asEnum(learning.mode, `${where}.learning.mode`, LEARNING_MODES),
      notes: asString(learning.notes, `${where}.learning.notes`),
    },
  }
}

export function validateBotIdentity(value: unknown, where: string): BotCatalogEntry['bot'] {
  const bot = asRecord(value, where)
  const id = asString(bot.id, `${where}.id`)
  if (!ID_PATTERN.test(id)) {
    fail(`${where}.id`, 'is not a valid bot ID')
  }

  let humanSkill: BotCatalogEntry['bot']['humanSkill']
  if (bot.humanSkill === 'uncalibrated') {
    humanSkill = 'uncalibrated'
  } else {
    const skill = asRecord(bot.humanSkill, `${where}.humanSkill`)
    humanSkill = {
      estimates: asArray(skill.estimates, `${where}.humanSkill.estimates`).map((item, i) => {
        const at = `${where}.humanSkill.estimates[${i}]`
        const estimate = asRecord(item, at)
        return {
          race: asEnum(estimate.race, `${at}.race`, RACE_NAMES),
          rating: asFiniteNumber(estimate.rating, `${at}.rating`),
          state: asEnum(
            estimate.state,
            `${at}.state`,
            new Set<'calibrated' | 'provisional'>(['calibrated', 'provisional']),
          ),
          measuredOn: asString(estimate.measuredOn, `${at}.measuredOn`),
        }
      }),
    }
  }

  return {
    id,
    name: asNonEmptyString(bot.name, `${where}.name`),
    description: asString(bot.description, `${where}.description`),
    authors: asArray(bot.authors, `${where}.authors`).map((item, i) => {
      const author = asRecord(item, `${where}.authors[${i}]`)
      return {
        name: asNonEmptyString(author.name, `${where}.authors[${i}].name`),
        url:
          author.url === undefined ? undefined : asString(author.url, `${where}.authors[${i}].url`),
      }
    }),
    homepage: asString(bot.homepage, `${where}.homepage`),
    sourceUrl: asString(bot.sourceUrl, `${where}.sourceUrl`),
    playStyleTags: asStringArray(bot.playStyleTags, `${where}.playStyleTags`),
    humanSkill,
    externalRatings: asArray(bot.externalRatings, `${where}.externalRatings`).map((item, i) => {
      const at = `${where}.externalRatings[${i}]`
      const rating = asRecord(item, at)
      return {
        provider: asString(rating.provider, `${at}.provider`),
        entry: asString(rating.entry, `${at}.entry`),
        rating: asFiniteNumber(rating.rating, `${at}.rating`),
        observedOn: asString(rating.observedOn, `${at}.observedOn`),
        ratedVersion:
          rating.ratedVersion === null ? null : asString(rating.ratedVersion, `${at}.ratedVersion`),
        sourceUrl: asString(rating.sourceUrl, `${at}.sourceUrl`),
        notes: asString(rating.notes, `${at}.notes`),
      }
    }),
  }
}

function validateEligibility(value: unknown, where: string): BotEligibility {
  const eligibility = asRecord(value, where)
  return {
    status: asEnum(eligibility.status, `${where}.status`, ELIGIBILITY_STATUSES),
    evidence: asString(eligibility.evidence, `${where}.evidence`),
  }
}

function validateSource(value: unknown, where: string) {
  const source = asRecord(value, where)
  return {
    id: asNonEmptyString(source.id, `${where}.id`),
    repository: asNonEmptyString(source.repository, `${where}.repository`),
    revision: asNonEmptyString(source.revision, `${where}.revision`),
  }
}

function validateArtifact(
  value: unknown,
  where: string,
  insecureOrigin: string | undefined,
): BotCatalogRelease['artifact'] {
  const artifact = asRecord(value, where)
  const url = asString(artifact.url, `${where}.url`)
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return fail(`${where}.url`, 'is not a URL')
  }
  const allowed =
    parsed.protocol === 'https:' ||
    (parsed.protocol === 'http:' && !!insecureOrigin && parsed.origin === insecureOrigin)
  if (!allowed) {
    fail(`${where}.url`, 'is not an https URL')
  }
  if (artifact.format !== 'zip') {
    fail(`${where}.format`, 'is not a supported archive format')
  }

  return {
    url,
    sha256: asHash(artifact.sha256, `${where}.sha256`),
    sizeBytes: asPositiveInt(artifact.sizeBytes, `${where}.sizeBytes`),
    manifestSha256: asHash(artifact.manifestSha256, `${where}.manifestSha256`),
    format: 'zip',
  }
}

/** Checks one package descriptor, wherever it came from (a catalog, or an installed record). */
export function validateBotPackage(
  value: unknown,
  where: string,
  botId: string,
): BotCatalogRelease['package'] {
  const pkg = asRecord(value, where)
  if (pkg.schemaVersion !== BOT_CATALOG_SCHEMA_VERSION) {
    fail(`${where}.schemaVersion`, 'is not a supported package schema version')
  }
  if (pkg.botId !== botId) {
    fail(`${where}.botId`, `does not match the bot it is listed under (${botId})`)
  }
  const releaseId = asString(pkg.releaseId, `${where}.releaseId`)
  if (!ID_PATTERN.test(releaseId)) {
    fail(`${where}.releaseId`, 'is not a valid release ID')
  }

  const platform = asRecord(pkg.platform, `${where}.platform`)
  if (platform.os !== 'windows') {
    fail(`${where}.platform.os`, 'is not a supported operating system')
  }

  const launch = asRecord(pkg.launch, `${where}.launch`)
  const workingDirectoryValue = asNonEmptyString(
    launch.workingDirectory,
    `${where}.launch.workingDirectory`,
  )
  const workingDirectory =
    workingDirectoryValue === '.'
      ? '.'
      : asPackagePath(workingDirectoryValue, `${where}.launch.workingDirectory`)

  const bwapi = asRecord(pkg.bwapi, `${where}.bwapi`)
  const build = asRecord(pkg.build, `${where}.build`)
  const sourceReview = asRecord(pkg.sourceReview, `${where}.sourceReview`)
  const permissions = asRecord(pkg.permissions, `${where}.permissions`)
  const licenses = asArray(pkg.licenses, `${where}.licenses`)
  if (licenses.length === 0) {
    fail(`${where}.licenses`, 'is empty')
  }

  return {
    schemaVersion: BOT_CATALOG_SCHEMA_VERSION,
    botId,
    releaseId,
    version: asNonEmptyString(pkg.version, `${where}.version`),
    platform: {
      os: 'windows',
      architecture: asEnum(platform.architecture, `${where}.platform.architecture`, ARCHITECTURES),
    },
    runtime: validateRuntime(pkg.runtime, `${where}.runtime`),
    launch: {
      entrypoint: asPackagePath(launch.entrypoint, `${where}.launch.entrypoint`),
      arguments: asStringArray(launch.arguments, `${where}.launch.arguments`),
      workingDirectory,
    },
    profile: validateProfile(pkg.profile, `${where}.profile`),
    bwapi: {
      version: asNonEmptyString(bwapi.version, `${where}.bwapi.version`),
      protocol: asPositiveInt(bwapi.protocol, `${where}.bwapi.protocol`),
      minimumBridgeVersion: asNonEmptyString(
        bwapi.minimumBridgeVersion,
        `${where}.bwapi.minimumBridgeVersion`,
      ),
    },
    sources: asArray(pkg.sources, `${where}.sources`).map((item, i) =>
      validateSource(item, `${where}.sources[${i}]`),
    ),
    licenses: licenses.map((item, i) => {
      const license = asRecord(item, `${where}.licenses[${i}]`)
      return {
        name: asNonEmptyString(license.name, `${where}.licenses[${i}].name`),
        noticePath: asPackagePath(license.noticePath, `${where}.licenses[${i}].noticePath`),
      }
    }),
    permissions: {
      localDistribution: validateEligibility(
        permissions.localDistribution,
        `${where}.permissions.localDistribution`,
      ),
      publicCompetition: validateEligibility(
        permissions.publicCompetition,
        `${where}.permissions.publicCompetition`,
      ),
    },
    writableDirectories: asArray(pkg.writableDirectories, `${where}.writableDirectories`).map(
      (item, i) => asPackagePath(item, `${where}.writableDirectories[${i}]`),
    ),
    build: {
      recipeSource: validateSource(build.recipeSource, `${where}.build.recipeSource`),
      recipePath: asNonEmptyString(build.recipePath, `${where}.build.recipePath`),
      toolchain: asNonEmptyString(build.toolchain, `${where}.build.toolchain`),
    },
    sourceReview: {
      status: asEnum(sourceReview.status, `${where}.sourceReview.status`, REVIEW_STATUSES) as
        'pending' | 'approved' | 'rejected',
      evidence: asString(sourceReview.evidence, `${where}.sourceReview.evidence`),
    },
    modifications:
      pkg.modifications === undefined
        ? undefined
        : asArray(pkg.modifications, `${where}.modifications`).map((item, i) => {
            const at = `${where}.modifications[${i}]`
            const modification = asRecord(item, at)
            return {
              modifier: asString(modification.modifier, `${at}.modifier`),
              date: asString(modification.date, `${at}.date`),
              summary: asString(modification.summary, `${at}.summary`),
              scope: asEnum(
                modification.scope,
                `${at}.scope`,
                new Set<'bot' | 'dependency'>(['bot', 'dependency']),
              ),
            }
          }),
  }
}

/**
 * Checks a parsed catalog document and returns it in the shape the rest of the app uses. Throws
 * with a displayable reason naming the field at fault.
 *
 * `catalogUrl` decides whether plaintext artifact URLs are acceptable: they are only when the
 * catalog itself came from a local development server, and only from that same origin.
 */
export function validateCatalogDocument(
  document: unknown,
  { catalogUrl }: { catalogUrl: string },
): BotCatalog {
  let insecureOrigin: string | undefined
  try {
    const parsed = new URL(catalogUrl)
    insecureOrigin = parsed.protocol === 'http:' ? parsed.origin : undefined
  } catch {
    insecureOrigin = undefined
  }

  const root = asRecord(document, 'catalog')
  if (root.schemaVersion !== BOT_CATALOG_SCHEMA_VERSION) {
    fail('catalog.schemaVersion', 'is not a supported catalog schema version')
  }
  if (
    typeof root.revision !== 'number' ||
    !Number.isSafeInteger(root.revision) ||
    root.revision < 0
  ) {
    fail('catalog.revision', 'is not a revision number')
  }

  const botIds = new Set<string>()
  const bots = asArray(root.bots, 'catalog.bots').map((item, i) => {
    const where = `catalog.bots[${i}]`
    const entry = asRecord(item, where)
    const bot = validateBotIdentity(entry.bot, `${where}.bot`)
    if (botIds.has(bot.id)) {
      fail(`${where}.bot.id`, 'is listed more than once')
    }
    botIds.add(bot.id)

    const releases = asArray(entry.releases, `${where}.releases`)
    if (releases.length === 0) {
      fail(`${where}.releases`, 'is empty')
    }
    const releaseIds = new Set<string>()
    return {
      bot,
      releases: releases.map((releaseItem, j) => {
        const releaseWhere = `${where}.releases[${j}]`
        const release = asRecord(releaseItem, releaseWhere)
        const pkg = validateBotPackage(release.package, `${releaseWhere}.package`, bot.id)
        if (releaseIds.has(pkg.releaseId)) {
          fail(`${releaseWhere}.package.releaseId`, 'is listed more than once')
        }
        releaseIds.add(pkg.releaseId)
        return {
          package: pkg,
          artifact: validateArtifact(release.artifact, `${releaseWhere}.artifact`, insecureOrigin),
        }
      }),
    }
  })

  return { schemaVersion: BOT_CATALOG_SCHEMA_VERSION, revision: root.revision, bots }
}

/**
 * Whether a bare (unsigned) catalog document is acceptable from this URL: only a catalog served
 * from this machine during development, since nothing else can vouch for it.
 */
function allowsUnsignedCatalog(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' && LOCAL_HOSTNAMES.has(parsed.hostname)
  } catch {
    return false
  }
}

/**
 * Turns a catalog document as served (a signed envelope, or a bare catalog from a local
 * development server) into a validated catalog. This is the only way a document becomes a catalog
 * the app acts on, whether it just arrived from the network or was read back from the cache, so
 * the signature is checked every time.
 */
export function openCatalogDocument(
  document: unknown,
  { url, trust }: { url: string; trust: CatalogTrust },
): BotCatalog {
  let inner = document
  if (looksLikeEnvelope(document)) {
    inner = openCatalogEnvelope(document, trust)
  } else if (!allowsUnsignedCatalog(url)) {
    throw new Error('The bot catalog is not signed')
  }
  return validateCatalogDocument(inner, { catalogUrl: url })
}

export interface FetchedCatalog {
  /** The document exactly as served, signature included, so it can be verified again later. */
  document: unknown
  catalog: BotCatalog
}

/**
 * Downloads and validates the catalog at `url`. Bounded in both time and size, since the response
 * is whatever the network hands back.
 */
export async function fetchCatalog(
  url: string,
  fetchImpl: typeof globalThis.fetch,
  trust: CatalogTrust,
): Promise<FetchedCatalog> {
  // A refresh is what the user reaches for when the catalog has changed, so it always goes to the
  // network instead of consulting the HTTP cache; the app keeps its own copy on disk anyway.
  const response = await fetchImpl(url, {
    signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS),
    headers: { accept: 'application/json' },
    cache: 'no-store',
  })
  if (!response.ok) {
    throw new Error(`Couldn't download the bot catalog (${response.status})`)
  }
  if (!response.body) {
    throw new Error(`Couldn't download the bot catalog (the response had no body)`)
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    received += value.byteLength
    if (received > MAX_CATALOG_BYTES) {
      await reader.cancel()
      throw new Error('The bot catalog is larger than this app will read')
    }
    chunks.push(value)
  }

  let document: unknown
  try {
    document = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new Error(`Couldn't read the bot catalog (it isn't valid JSON)`)
  }
  return { document, catalog: openCatalogDocument(document, { url, trust }) }
}
