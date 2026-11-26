import { ReadonlyDeep } from 'type-fest'
import { Jsonify } from '../json'
import { MapInfoJson, SbMapId } from '../maps'
import { getMatchmakingModeInfo, hasVetoes, MatchmakingType } from '../matchmaking'

export const MATCHMAKING_MAP_POOLS_LIMIT = 5

export interface MatchmakingMapPool {
  id: number
  matchmakingType: MatchmakingType
  maps: SbMapId[]
  maxVetoCount: number
  startDate: Date
}

export type MatchmakingMapPoolJson = Jsonify<MatchmakingMapPool>

export function toMatchmakingMapPoolJson(pool: MatchmakingMapPool): MatchmakingMapPoolJson {
  return {
    id: pool.id,
    matchmakingType: pool.matchmakingType,
    maps: pool.maps,
    maxVetoCount: pool.maxVetoCount,
    startDate: Number(pool.startDate),
  }
}

export interface GetMatchmakingMapPoolResponse {
  pool: MatchmakingMapPoolJson
  mapInfos: MapInfoJson[]
  /** How `pool` differs from the pool before it. Absent when the type has no earlier pool. */
  changes?: MatchmakingMapPoolChanges
}

export interface GetMatchmakingMapPoolsHistoryResponse {
  pools: MatchmakingMapPoolJson[]
  mapInfos: MapInfoJson[]
  hasMorePools: boolean
}

export interface CreateMatchmakingMapPoolRequest {
  maps: ReadonlyArray<SbMapId>
  maxVetoCount: number
  startDate: number
}

export interface CreateMatchmakingMapPoolResponse {
  pool: MatchmakingMapPoolJson
  mapInfos: MapInfoJson[]
}

/** How a matchmaking map pool differs from the pool that preceded it for the same matchmaking type. */
export interface MatchmakingMapPoolChanges {
  /** Maps in this pool that the preceding pool did not have, in this pool's order. */
  addedMaps: SbMapId[]
  /** Maps the preceding pool had that this pool does not, in the preceding pool's order. */
  removedMaps: SbMapId[]
  previousMapCount: number
  previousMaxVetoCount: number
}

export function computeMapPoolChanges(
  previous: ReadonlyDeep<Pick<MatchmakingMapPool, 'maps' | 'maxVetoCount'>>,
  current: ReadonlyDeep<Pick<MatchmakingMapPool, 'maps' | 'maxVetoCount'>>,
): MatchmakingMapPoolChanges {
  const previousMaps = new Set<SbMapId>(previous.maps)
  const currentMaps = new Set<SbMapId>(current.maps)
  return {
    addedMaps: current.maps.filter(id => !previousMaps.has(id)),
    removedMaps: previous.maps.filter(id => !currentMaps.has(id)),
    previousMapCount: previous.maps.length,
    previousMaxVetoCount: previous.maxVetoCount,
  }
}

/**
 * Returns a list of selected map IDs filtered to match the current map pool (and within the limit
 * of the current pool's max veto count if the selections are vetoes).
 */
export function filterMapSelections(
  mapPool: ReadonlyDeep<Pick<MatchmakingMapPool, 'matchmakingType' | 'maps' | 'maxVetoCount'>>,
  selectedMapIds: ReadonlyArray<SbMapId> = [],
): SbMapId[] {
  const result = selectedMapIds.filter(id => mapPool.maps.includes(id))
  return hasVetoes(mapPool.matchmakingType) ? result.slice(0, mapPool.maxVetoCount) : result
}

/** What a map pool change means for one player's preferences. */
export interface MapPoolChangeNotice {
  addedMaps: SbMapId[]
  removedMaps: SbMapId[]
  /** Present only when the number of maps in the pool changed. */
  mapCount?: { previous: number; current: number }
  /** Present only when the veto limit changed, for modes whose maps are vetoed. */
  maxVetoCount?: { previous: number; current: number }
  /** The player's map selections that the current pool does not carry over. */
  droppedSelections: Array<{ mapId: SbMapId; reason: 'mapRemoved' | 'vetoLimit' }>
}

/**
 * Returns what changed for a player whose preferences were last saved against the map pool
 * `preferences.mapPoolId`, or `undefined` if they have already seen `mapPool` or nothing changed.
 */
export function getMapPoolChangeNotice(
  preferences: ReadonlyDeep<{ mapPoolId: number; mapSelections?: ReadonlyArray<SbMapId> }>,
  mapPool: ReadonlyDeep<
    Pick<MatchmakingMapPool, 'id' | 'matchmakingType' | 'maps' | 'maxVetoCount'>
  >,
  changes: ReadonlyDeep<MatchmakingMapPoolChanges> | undefined,
): MapPoolChangeNotice | undefined {
  if (preferences.mapPoolId === mapPool.id) {
    return undefined
  }

  const style = getMatchmakingModeInfo(mapPool.matchmakingType).mapSelectionStyle
  const notice: MapPoolChangeNotice = {
    addedMaps: changes ? [...changes.addedMaps] : [],
    removedMaps: changes ? [...changes.removedMaps] : [],
    droppedSelections: [],
  }

  if (changes && changes.previousMapCount !== mapPool.maps.length) {
    notice.mapCount = { previous: changes.previousMapCount, current: mapPool.maps.length }
  }
  if (changes && style === 'veto' && changes.previousMaxVetoCount !== mapPool.maxVetoCount) {
    notice.maxVetoCount = { previous: changes.previousMaxVetoCount, current: mapPool.maxVetoCount }
  }

  // Fixed modes ignore selections entirely, so nothing a player chose can be lost there.
  if (style !== 'fixed') {
    const selections = preferences.mapSelections ?? []
    const kept = new Set(filterMapSelections(mapPool, selections))
    for (const mapId of selections) {
      if (!kept.has(mapId)) {
        notice.droppedSelections.push({
          mapId,
          reason: mapPool.maps.includes(mapId) ? 'vetoLimit' : 'mapRemoved',
        })
      }
    }
  }

  if (
    !notice.addedMaps.length &&
    !notice.removedMaps.length &&
    !notice.mapCount &&
    !notice.maxVetoCount &&
    !notice.droppedSelections.length
  ) {
    return undefined
  }
  return notice
}

/** Whether a pool change should stop a player from queueing until they have seen it. */
export function isMapPoolChangeInterrupting(notice: ReadonlyDeep<MapPoolChangeNotice>): boolean {
  return (
    notice.addedMaps.length > 0 ||
    notice.droppedSelections.length > 0 ||
    notice.maxVetoCount !== undefined
  )
}
