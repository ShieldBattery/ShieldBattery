/**
 * Pure practice-matchmaking logic: which parts of a pool can be played, how a matchup is drawn, and
 * which bots to recommend for a player's rating.
 */

import { GameType } from '../games/game-type'
import { MapInfoJson, SbMapId } from '../maps'
import { BotRaceName } from './bot-catalog'
import { BotKey } from './bot-library'
import { BotView, botCanPlayMap, botFormatCompatibility, isBotReady } from './bot-view'
import { PracticeBotRef } from './practice'

export interface LineupEntryStatus {
  ref: PracticeBotRef
  /** Undefined when the saved bot is no longer in the library at all. */
  bot: BotView | undefined
  /** Whether this entry can be drawn right now. */
  playable: boolean
  /** Maps in the pool this bot can play (empty when nothing fits). */
  playableMapIds: SbMapId[]
}

export interface PoolReadiness {
  entries: LineupEntryStatus[]
  /** Maps in the pool whose files are on this PC. */
  installedMaps: MapInfoJson[]
  /** Maps in the pool that still need downloading. */
  missingMaps: MapInfoJson[]
  /** Maps in the pool the app has no metadata for (e.g. a preset saved while online). */
  unknownMapIds: SbMapId[]
  playableEntries: LineupEntryStatus[]
  /** Whether at least one map/bot pair can be drawn. */
  canDraw: boolean
}

export function computePoolReadiness({
  lineup,
  bots,
  poolMapIds,
  knownMaps,
  installedMapHashes,
}: {
  lineup: PracticeBotRef[]
  bots: BotView[]
  poolMapIds: SbMapId[]
  knownMaps: Record<SbMapId, MapInfoJson>
  installedMapHashes: ReadonlySet<string>
}): PoolReadiness {
  const botsByKey = new Map(bots.map(b => [b.key, b]))
  const installedMaps: MapInfoJson[] = []
  const missingMaps: MapInfoJson[] = []
  const unknownMapIds: SbMapId[] = []
  for (const mapId of poolMapIds) {
    const map = knownMaps[mapId]
    if (!map) {
      unknownMapIds.push(mapId)
    } else if (installedMapHashes.has(map.hash)) {
      installedMaps.push(map)
    } else {
      missingMaps.push(map)
    }
  }

  const entries = lineup.map<LineupEntryStatus>(ref => {
    const bot = botsByKey.get(ref.key)
    if (!bot || !isBotReady(bot)) {
      return { ref, bot, playable: false, playableMapIds: [] }
    }
    const compat = botFormatCompatibility(bot, GameType.Melee, 1)
    if (compat.support === 'incompatible') {
      return { ref, bot, playable: false, playableMapIds: [] }
    }
    const playableMapIds = installedMaps.filter(m => botCanPlayMap(bot, m)).map(m => m.id)
    return { ref, bot, playable: playableMapIds.length > 0, playableMapIds }
  })
  const playableEntries = entries.filter(e => e.playable)

  return {
    entries,
    installedMaps,
    missingMaps,
    unknownMapIds,
    playableEntries,
    canDraw: playableEntries.length > 0,
  }
}

export interface DrawnMatchup {
  bot: BotView
  mapId: SbMapId
  race: BotRaceName
}

/**
 * Draws one playable opponent, a map it can play, and a race it supports. The previous opponent is
 * avoided when the pool offers any alternative, so back-to-back games vary; beyond that the draw is
 * uniform over playable entries, not over bots weighted by anything else.
 */
export function drawMatchup(
  readiness: PoolReadiness,
  previousBotKey: BotKey | undefined,
  random: () => number = Math.random,
): DrawnMatchup | undefined {
  let candidates = readiness.playableEntries
  if (candidates.length === 0) {
    return undefined
  }
  if (previousBotKey && candidates.length > 1) {
    const others = candidates.filter(e => e.ref.key !== previousBotKey)
    if (others.length > 0) {
      candidates = others
    }
  }
  const entry = candidates[Math.floor(random() * candidates.length)]
  const bot = entry.bot!
  const mapId = entry.playableMapIds[Math.floor(random() * entry.playableMapIds.length)]
  const race = bot.races[Math.floor(random() * bot.races.length)]
  return { bot, mapId, race }
}

export type RecommendationBand = 'gentler' | 'even' | 'tougher'

/** Rating distance from the player, relative to their rating, that each band covers. */
export const RECOMMENDATION_BANDS: Record<RecommendationBand, [low: number, high: number]> = {
  gentler: [-450, -150],
  even: [-150, 150],
  tougher: [150, 450],
}

export interface BotRecommendation {
  bot: BotView
  race: BotRaceName
  rating: number
  /** Positive when the bot is stronger than the player. */
  delta: number
}

/**
 * Bots with a calibrated strength within the band of the player's rating, closest first. A bot with
 * several rated races appears once, with the race that fits best. Uncalibrated bots never appear:
 * they are browsable, but not presented as measured matches.
 */
export function recommendBots(
  bots: BotView[],
  playerRating: number,
  band: RecommendationBand,
): BotRecommendation[] {
  const [low, high] = RECOMMENDATION_BANDS[band]
  const results: BotRecommendation[] = []
  for (const bot of bots) {
    let best: BotRecommendation | undefined
    for (const { race, estimate } of bot.strength) {
      if (!estimate || estimate.state !== 'calibrated') {
        continue
      }
      const delta = estimate.rating - playerRating
      if (delta < low || delta > high) {
        continue
      }
      if (!best || Math.abs(delta) < Math.abs(best.delta)) {
        best = { bot, race, rating: estimate.rating, delta }
      }
    }
    if (best) {
      results.push(best)
    }
  }
  return results.sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta))
}

/** Whether any bot has a calibrated estimate at all, so a "no bots near you" state is honest. */
export function hasAnyCalibratedBot(bots: BotView[]): boolean {
  return bots.some(b => b.strength.some(s => s.estimate?.state === 'calibrated'))
}

/** The strongest calibrated rating for a bot, for the strength sort. */
export function botPeakRating(bot: BotView): number | undefined {
  let peak: number | undefined
  for (const { estimate } of bot.strength) {
    if (estimate && (peak === undefined || estimate.rating > peak)) {
      peak = estimate.rating
    }
  }
  return peak
}

/** A key that changes once per calendar day in the user's local time zone. */
export function localDayKey(now: Date): string {
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`
}

/** 32-bit FNV-1a, enough to spread day keys across a handful of items. */
function hashString(value: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/**
 * Picks one of `items` deterministically for a day, so a backdrop drawn from an unchanging pool
 * still rotates instead of showing the same map forever.
 */
export function pickDailyItem<T>(items: ReadonlyArray<T>, dayKey: string): T | undefined {
  if (items.length === 0) {
    return undefined
  }
  return items[hashString(dayKey) % items.length]
}
