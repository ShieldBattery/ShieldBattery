/**
 * Types for the bot catalog and package descriptors. These mirror the JSON schema published by the
 * robotics-facility repository (`schemas/metadata.schema.json`); documents that fail that schema's
 * structural rules are rejected before they reach these types.
 */

import { AssignedRaceChar } from '../races'

export type BotRaceName = 'zerg' | 'terran' | 'protoss'

export const ALL_BOT_RACE_NAMES: ReadonlyArray<BotRaceName> = ['zerg', 'terran', 'protoss']

export function botRaceToRaceChar(race: BotRaceName): AssignedRaceChar {
  switch (race) {
    case 'zerg':
      return 'z'
    case 'terran':
      return 't'
    case 'protoss':
      return 'p'
    default:
      return race satisfies never
  }
}

export function raceCharToBotRace(race: AssignedRaceChar): BotRaceName {
  switch (race) {
    case 'z':
      return 'zerg'
    case 't':
      return 'terran'
    case 'p':
      return 'protoss'
    default:
      return race satisfies never
  }
}

export type BotFormatId = 'one-v-one' | 'teams' | 'free-for-all'

export type BotFormatSupport = 'verified' | 'experimental' | 'incompatible' | 'unverified'

export interface BotFormatSupportInfo {
  id: BotFormatId
  support: BotFormatSupport
  notes: string
}

export type BotLearningMode = 'persistent' | 'none' | 'unknown'

export interface BotLearningInfo {
  mode: BotLearningMode
  notes: string
}

export type BotRandomRaceSupport = 'supported' | 'unsupported' | 'unverified'

/** What a bot release can play: races, formats, map restrictions and saved-state behavior. */
export interface BotProfile {
  selectableRaces: BotRaceName[]
  randomRace: BotRandomRaceSupport
  formats: BotFormatSupportInfo[]
  mapConstraints: string[]
  learning: BotLearningInfo
}

export interface BotAuthor {
  name: string
  url?: string
}

/** A rating observed on an external bot ladder/tournament. Never a human MMR. */
export interface BotExternalRating {
  provider: string
  entry: string
  rating: number
  observedOn: string
  ratedVersion: string | null
  sourceUrl: string
  notes: string
}

/**
 * A human-comparable strength estimate for one race of a bot. `provisional` estimates come from
 * too few games to be trusted as a division; `calibrated` ones are measured.
 */
export interface BotHumanSkillEstimate {
  race: BotRaceName
  /** A rating on the same scale as ShieldBattery's 1v1 ladder rating. */
  rating: number
  state: 'calibrated' | 'provisional'
  measuredOn: string
}

export type BotHumanSkill = 'uncalibrated' | { estimates: BotHumanSkillEstimate[] }

export interface BotIdentity {
  id: string
  name: string
  description: string
  authors: BotAuthor[]
  homepage: string
  sourceUrl: string
  /**
   * Stable lowercase IDs from `PLAY_STYLE_TAG_IDS`, never display text. IDs the app doesn't know
   * are kept but shown nowhere, so a catalog can add a tag before the app has a label for it.
   */
  playStyleTags: string[]
  humanSkill: BotHumanSkill
  externalRatings: BotExternalRating[]
}

export type BotArchitecture = 'x86' | 'x86_64'

export type BotRuntime =
  | { kind: 'native' }
  | { kind: 'java'; major: number; architecture: BotArchitecture; jvmArguments?: string[] }

export interface BotPackageLaunch {
  /** Path inside the package to the executable (or JAR for Java bots). */
  entrypoint: string
  arguments: string[]
  /** Path inside the package to run from, or `.` for the package root. */
  workingDirectory: string
}

export interface BotSource {
  id: string
  repository: string
  revision: string
  patches?: Array<{ path: string; sha256: string }>
}

export type BotEligibilityStatus = 'unreviewed' | 'approved' | 'restricted' | 'denied'

export interface BotEligibility {
  status: BotEligibilityStatus
  evidence: string
}

export interface BotPermissions {
  localDistribution: BotEligibility
  publicCompetition: BotEligibility
}

export interface BotLicense {
  name: string
  /** Path inside the package to the full license/notice text. */
  noticePath: string
}

/** A downstream change to the packaged bot, shown to the user as a modification notice. */
export interface BotModification {
  modifier: string
  date: string
  summary: string
  /** Whether the change touched the bot itself or only a bundled dependency. */
  scope: 'bot' | 'dependency'
}

/** An immutable, installable release of a bot. */
export interface BotPackage {
  schemaVersion: 1
  botId: string
  releaseId: string
  version: string
  platform: { os: 'windows'; architecture: BotArchitecture }
  runtime: BotRuntime
  launch: BotPackageLaunch
  profile: BotProfile
  bwapi: { version: string; protocol: number; minimumBridgeVersion: string }
  sources: BotSource[]
  licenses: BotLicense[]
  permissions: BotPermissions
  /** Package-relative directories the bot writes to; these live in the learning profile. */
  writableDirectories: string[]
  build: { recipeSource: BotSource; recipePath: string; toolchain: string }
  sourceReview: { status: 'pending' | 'approved' | 'rejected'; evidence: string }
  modifications?: BotModification[]
}

export interface BotArtifact {
  url: string
  sha256: string
  sizeBytes: number
  manifestSha256: string
  format: 'zip'
}

export interface BotCatalogRelease {
  package: BotPackage
  artifact: BotArtifact
}

export interface BotCatalogEntry {
  bot: BotIdentity
  releases: BotCatalogRelease[]
}

export interface BotCatalog {
  schemaVersion: 1
  revision: number
  bots: BotCatalogEntry[]
}

export const BOT_CATALOG_SCHEMA_VERSION = 1

/** The most recent release listed for an entry (releases are ordered oldest to newest). */
export function latestCatalogRelease(entry: BotCatalogEntry): BotCatalogRelease | undefined {
  return entry.releases[entry.releases.length - 1]
}

export function botFormatSupportFor(
  profile: BotProfile,
  format: BotFormatId,
): BotFormatSupportInfo | undefined {
  return profile.formats.find(f => f.id === format)
}

/** The play-style tag vocabulary the catalog publisher validates against. */
export const PLAY_STYLE_TAG_IDS = [
  'air-focused',
  'bio',
  'mech',
  'aggressive',
  'cheese',
  'defensive',
  'macro',
  'timing-attack',
  'drops',
  'harassment',
  'micro-heavy',
  'reactive',
  'varied-openings',
] as const

export type BotPlayStyleTag = (typeof PLAY_STYLE_TAG_IDS)[number]
