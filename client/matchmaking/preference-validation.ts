import { ReadonlyDeep } from 'type-fest'
import { getMatchmakingModeInfo, MatchmakingPreferencesDraft } from '../../common/matchmaking'
import { MatchmakingMapPoolJson } from '../../common/matchmaking/matchmaking-map-pools'

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
