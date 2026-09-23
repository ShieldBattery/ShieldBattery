/**
 * Derives what the UI needs to know about each bot from a library snapshot: identity, capabilities,
 * install state and readiness. Everything here is pure so both processes and tests can use it.
 */

import { GameType } from '../games/game-type'
import { MapInfoJson } from '../maps'
import {
  BotArchitecture,
  BotAuthor,
  BotCatalogEntry,
  BotCatalogRelease,
  BotFormatId,
  BotFormatSupport,
  BotFormatSupportInfo,
  BotHumanSkillEstimate,
  BotLearningInfo,
  BotModification,
  BotRaceName,
  BotRandomRaceSupport,
  BotRuntime,
  latestCatalogRelease,
} from './bot-catalog'
import {
  BotInstallFailure,
  BotInstallProgress,
  BotKey,
  BotLibrarySnapshot,
  InstalledBotRelease,
  JavaRuntimeInfo,
  LocalBuildBot,
} from './bot-library'

export type BotReadiness =
  | { state: 'ready' }
  | { state: 'notInstalled'; sizeBytes: number; canDownload: boolean }
  | { state: 'installing'; progress: BotInstallProgress }
  | { state: 'installFailed'; failure: BotInstallFailure }
  | { state: 'missingRuntime'; runtime: Extract<BotRuntime, { kind: 'java' }> }
  | { state: 'missingFiles'; detail: string }

export interface BotStrength {
  race: BotRaceName
  estimate: BotHumanSkillEstimate | undefined
}

/** Everything the UI shows for one bot, whichever its source. */
export interface BotView {
  key: BotKey
  source: 'catalog' | 'local'
  name: string
  /** The version that would run: the installed one, else the latest catalog release. */
  version: string
  releaseId?: string
  description: string
  authors: BotAuthor[]
  homepage?: string
  sourceUrl?: string
  playStyleTags: string[]
  races: BotRaceName[]
  randomRace: BotRandomRaceSupport
  formats: BotFormatSupportInfo[]
  mapConstraints: string[]
  learning: BotLearningInfo
  runtime: BotRuntime
  strength: BotStrength[]
  readiness: BotReadiness
  installed?: InstalledBotRelease
  catalogEntry?: BotCatalogEntry
  localBuild?: LocalBuildBot
  /** A newer catalog release than the installed one. */
  updateAvailable?: BotCatalogRelease
  modifications: BotModification[]
  inUse: boolean
  hasLearningData: boolean
  javaOverride?: string
}

export function isBotReady(bot: BotView): boolean {
  return bot.readiness.state === 'ready'
}

export function findJavaRuntime(
  detected: JavaRuntimeInfo[],
  runtime: Extract<BotRuntime, { kind: 'java' }>,
): JavaRuntimeInfo | undefined {
  return detected.find(
    java => java.major === runtime.major && java.architecture === runtime.architecture,
  )
}

function computeReadiness(
  snapshot: BotLibrarySnapshot,
  key: BotKey,
  runtime: BotRuntime,
  installed: InstalledBotRelease | undefined,
  latest: BotCatalogRelease | undefined,
  localBuild: LocalBuildBot | undefined,
): BotReadiness {
  const progress = snapshot.installs.find(i => i.botId === key)
  if (progress) {
    return { state: 'installing', progress }
  }
  const failure = snapshot.installFailures.find(f => f.botId === key)
  if (failure) {
    return { state: 'installFailed', failure }
  }
  if (!installed && !localBuild) {
    return {
      state: 'notInstalled',
      sizeBytes: latest?.artifact.sizeBytes ?? 0,
      canDownload: !!latest,
    }
  }
  if (runtime.kind === 'java') {
    const override = snapshot.java.overrides[key]
    if (!override && !findJavaRuntime(snapshot.java.detected, runtime)) {
      return { state: 'missingRuntime', runtime }
    }
  }
  return { state: 'ready' }
}

function strengthFor(
  races: BotRaceName[],
  humanSkill: BotCatalogEntry['bot']['humanSkill'] | undefined,
): BotStrength[] {
  const estimates = humanSkill && humanSkill !== 'uncalibrated' ? humanSkill.estimates : []
  return races.map(race => ({ race, estimate: estimates.find(e => e.race === race) }))
}

export function buildBotViews(snapshot: BotLibrarySnapshot): BotView[] {
  const views: BotView[] = []
  const installedById = new Map(snapshot.installed.map(i => [i.botId, i]))
  const catalogById = new Map((snapshot.catalog?.bots ?? []).map(e => [e.bot.id, e]))
  const inUse = new Set(snapshot.inUse)
  const hasLearningData = new Set(snapshot.hasLearningData)

  const catalogKeys = new Set([...installedById.keys(), ...catalogById.keys()])
  for (const key of catalogKeys) {
    const installed = installedById.get(key)
    const entry = catalogById.get(key)
    const latest = entry ? latestCatalogRelease(entry) : undefined
    // Identity metadata (tags, ratings, description) is corrected through catalog revisions rather
    // than new releases, so a catalog entry wins over what was saved at install time; the saved
    // copy only serves a bot the catalog no longer lists.
    const identity = entry?.bot ?? installed?.bot
    const pkg = installed?.package ?? latest?.package
    if (!identity || !pkg) {
      continue
    }
    const updateAvailable =
      installed && latest && latest.package.releaseId !== installed.releaseId ? latest : undefined
    views.push({
      key,
      source: 'catalog',
      name: identity.name,
      version: pkg.version,
      releaseId: pkg.releaseId,
      description: identity.description,
      authors: identity.authors,
      homepage: identity.homepage,
      sourceUrl: identity.sourceUrl,
      playStyleTags: identity.playStyleTags,
      races: pkg.profile.selectableRaces,
      randomRace: pkg.profile.randomRace,
      formats: pkg.profile.formats,
      mapConstraints: pkg.profile.mapConstraints,
      learning: pkg.profile.learning,
      runtime: pkg.runtime,
      strength: strengthFor(pkg.profile.selectableRaces, identity.humanSkill),
      readiness: computeReadiness(snapshot, key, pkg.runtime, installed, latest, undefined),
      installed,
      catalogEntry: entry,
      updateAvailable,
      modifications: pkg.modifications ?? [],
      inUse: inUse.has(key),
      hasLearningData: hasLearningData.has(key),
      javaOverride: snapshot.java.overrides[key],
    })
  }

  for (const build of snapshot.localBuilds) {
    views.push({
      key: build.key,
      source: 'local',
      name: build.name,
      version: build.version,
      description: '',
      authors: [],
      playStyleTags: [],
      races: build.races,
      randomRace: 'unsupported',
      formats: build.formats,
      mapConstraints: [],
      learning: build.learning,
      runtime: build.runtime,
      strength: strengthFor(build.races, undefined),
      readiness: computeReadiness(snapshot, build.key, build.runtime, undefined, undefined, build),
      localBuild: build,
      modifications: [],
      inUse: inUse.has(build.key),
      hasLearningData: hasLearningData.has(build.key),
      javaOverride: snapshot.java.overrides[build.key],
    })
  }

  return views.sort((a, b) => a.name.localeCompare(b.name))
}

/** The catalog format a bot plays in a game of this type against this many opponents. */
export function botFormatForGame(gameType: GameType, opponentCount: number): BotFormatId {
  if (gameType === GameType.FreeForAll) {
    return 'free-for-all'
  }
  if (opponentCount <= 1) {
    return 'one-v-one'
  }
  return gameType === GameType.TopVsBottom ? 'teams' : 'free-for-all'
}

/**
 * Whether a bot may be placed in a game of this shape. Untested formats are allowed with guidance;
 * only a known-incompatible format blocks the start.
 */
export function botFormatCompatibility(
  bot: Pick<BotView, 'formats'>,
  gameType: GameType,
  opponentCount: number,
): { format: BotFormatId; support: BotFormatSupport; notes: string | undefined } {
  const format = botFormatForGame(gameType, opponentCount)
  const info = bot.formats.find(f => f.id === format)
  return { format, support: info?.support ?? 'unverified', notes: info?.notes }
}

/** Whether a bot supports this map for a game against one human (2 slots needed). */
export function botCanPlayMap(bot: Pick<BotView, 'mapConstraints'>, map: MapInfoJson): boolean {
  return map.mapData.slots >= 2 && !map.mapData.isEud
}

export function architectureLabel(architecture: BotArchitecture): string {
  return architecture === 'x86' ? '32-bit' : '64-bit'
}
