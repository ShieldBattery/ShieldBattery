/**
 * The desktop app's local bot library: what is installed on this PC, what the last downloaded
 * catalog offers, and which runtimes are available. The main process owns all of this; the
 * renderer only reads snapshots and sends requests over IPC.
 */

import { Jsonify } from '../json'
import {
  BotArchitecture,
  BotCatalogEntry,
  BotFormatSupportInfo,
  BotIdentity,
  BotLearningInfo,
  BotPackage,
  BotRaceName,
  BotRuntime,
} from './bot-catalog'

/**
 * Identifies a bot in the library regardless of where it came from. Catalog bots use the catalog
 * bot ID; bring-your-own builds use `local:<uuid>` so they can never collide with catalog IDs.
 */
export type BotKey = string

export const LOCAL_BUILD_KEY_PREFIX = 'local:'

export function isLocalBuildKey(key: BotKey): boolean {
  return key.startsWith(LOCAL_BUILD_KEY_PREFIX)
}

/** A catalog release installed on this PC. Package directories are immutable once promoted. */
export interface InstalledBotRelease {
  botId: string
  releaseId: string
  version: string
  installedAt: number
  sizeBytes: number
  /** SHA-256 of the downloaded archive. */
  digest: string
  /** The catalog identity at install time, retained so removal from the catalog changes nothing. */
  bot: BotIdentity
  /** The package descriptor from inside the archive. */
  package: BotPackage
}

/**
 * A bot the user pointed the app at directly (a developer's local build). It carries the same
 * capability information as a package descriptor but the user supplied it, so it is never shown as
 * a reviewed catalog release.
 */
export interface LocalBuildBot {
  key: BotKey
  name: string
  /** A version label chosen by the user, e.g. `dev` or a git hash. */
  version: string
  executable: string
  args: string[]
  workingDirectory: string
  runtime: BotRuntime
  races: BotRaceName[]
  formats: BotFormatSupportInfo[]
  learning: BotLearningInfo
  addedAt: number
  updatedAt: number
}

/** What the user fills in to add or refresh a local build. */
export interface LocalBuildBotSpec {
  name: string
  version: string
  executable: string
  args: string[]
  workingDirectory: string
  runtime: BotRuntime
  races: BotRaceName[]
}

export type BotInstallPhase = 'downloading' | 'verifying' | 'installing'

export interface BotInstallProgress {
  botId: string
  releaseId: string
  phase: BotInstallPhase
  receivedBytes: number
  totalBytes: number
}

export interface BotInstallFailure {
  botId: string
  releaseId: string
  error: string
  receivedBytes: number
  totalBytes: number
  failedAt: number
}

export interface JavaRuntimeInfo {
  /** Path to `java.exe`. */
  path: string
  /** Major version from `java.specification.version` (e.g. 8, 17). */
  major: number
  architecture: BotArchitecture
}

export interface CachedBotCatalog {
  revision: number
  fetchedAt: number
  /** Where the catalog was fetched from, so a channel switch never mixes caches. */
  url: string
  bots: BotCatalogEntry[]
}

export interface BotCatalogStatus {
  refreshing: boolean
  /** A displayable reason the last refresh failed. The cached catalog stays usable. */
  lastError?: string
}

export interface BotLibrarySnapshot {
  catalog?: CachedBotCatalog
  catalogStatus: BotCatalogStatus
  installed: InstalledBotRelease[]
  localBuilds: LocalBuildBot[]
  installs: BotInstallProgress[]
  installFailures: BotInstallFailure[]
  java: {
    detected: JavaRuntimeInfo[]
    checkedAt?: number
    /** Per-bot `java.exe` override chosen by the user. */
    overrides: Record<BotKey, string>
  }
  /** Bots leased by a running game; their files and learning must not be changed. */
  inUse: BotKey[]
  /** Bot keys with a non-empty learning profile on disk. */
  hasLearningData: BotKey[]
}

export type BotLibrarySnapshotJson = Jsonify<BotLibrarySnapshot>

/**
 * A bot as chosen for a game. The main process resolves executables, arguments, working
 * directories and runtimes from the library, so the renderer never handles file paths.
 */
export interface PracticeBotSelection {
  key: BotKey
  /** For catalog bots, the exact installed release to run. */
  releaseId?: string
  race: BotRaceName
  /**
   * The name shown in-game. Defaults to the bot's real name; practice matchmaking with a hidden
   * opponent passes a generic name and records the real identity in the practice history.
   */
  inGameName?: string
}
