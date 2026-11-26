import { ReadonlyDeep } from 'type-fest'
import {
  ALL_MATCHMAKING_TYPES,
  getMatchmakingModeInfo,
  MatchmakingPreferencesDraft,
  MatchmakingType,
} from '../../common/matchmaking'
import {
  getMapPoolChangeNotice,
  isMapPoolChangeInterrupting,
  MatchmakingMapPoolChanges,
  MatchmakingMapPoolJson,
} from '../../common/matchmaking/matchmaking-map-pools'

export type MatchmakingPreferencesError = 'race' | 'maps' | 'loading'

export function getMatchmakingPreferencesError(
  preferences: ReadonlyDeep<MatchmakingPreferencesDraft> | undefined,
  mapPool: ReadonlyDeep<MatchmakingMapPoolJson> | undefined,
): MatchmakingPreferencesError | undefined {
  if (!preferences) {
    return 'loading'
  }
  if (!preferences.race) {
    return 'race'
  }
  if (getMatchmakingModeInfo(preferences.matchmakingType).mapSelectionStyle === 'pick') {
    if (!mapPool) {
      return 'loading'
    }
    if (!preferences.mapSelections.some(id => mapPool.maps.includes(id))) {
      return 'maps'
    }
  }
  return undefined
}

/** What should happen when a player asks to queue for a set of matchmaking types. */
export type MatchmakingQueuePlan =
  /** Some type's settings haven't loaded yet, so nothing can be decided. */
  | { kind: 'loading' }
  /** The player has to see the settings of `reviewTypes` (in this order) before queueing. */
  | { kind: 'review'; reviewTypes: MatchmakingType[] }
  /** The search can start with the stored preferences as they are. */
  | { kind: 'queue'; preferences: Array<ReadonlyDeep<MatchmakingPreferencesDraft>> }

export interface MatchmakingQueueState {
  preferencesByType: ReadonlyMap<
    MatchmakingType,
    { preferences?: ReadonlyDeep<MatchmakingPreferencesDraft> }
  >
  mapPoolsByType: ReadonlyMap<MatchmakingType, ReadonlyDeep<MatchmakingMapPoolJson>>
  mapPoolChangesByType: ReadonlyMap<MatchmakingType, ReadonlyDeep<MatchmakingMapPoolChanges>>
}

/** Returns `types` in the order the find-match screen lists them, without duplicates. */
export function orderMatchmakingTypes(types: Iterable<MatchmakingType>): MatchmakingType[] {
  const requested = new Set(types)
  return ALL_MATCHMAKING_TYPES.filter(type => requested.has(type))
}

/**
 * Decides whether queueing for `types` can go ahead. A type needs review when its settings can't be
 * searched with (no race, or no map picked), or when its map pool changed since the player last
 * saved its settings in a way that affects how they play it.
 */
export function planMatchmakingQueue(
  types: Iterable<MatchmakingType>,
  state: MatchmakingQueueState,
): MatchmakingQueuePlan {
  const ordered = orderMatchmakingTypes(types)
  const reviewTypes: MatchmakingType[] = []
  const preferences: Array<ReadonlyDeep<MatchmakingPreferencesDraft>> = []

  for (const type of ordered) {
    const prefs = state.preferencesByType.get(type)?.preferences
    const mapPool = state.mapPoolsByType.get(type)
    const error = getMatchmakingPreferencesError(prefs, mapPool)
    if (error === 'loading' || !prefs) {
      return { kind: 'loading' }
    }

    const notice = mapPool
      ? getMapPoolChangeNotice(prefs, mapPool, state.mapPoolChangesByType.get(type))
      : undefined
    if (error || (notice && isMapPoolChangeInterrupting(notice))) {
      reviewTypes.push(type)
    }
    preferences.push(prefs)
  }

  return reviewTypes.length ? { kind: 'review', reviewTypes } : { kind: 'queue', preferences }
}
