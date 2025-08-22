import { ReadonlyDeep } from 'type-fest'
import { SbMapId } from '../../../common/maps'
import { hasVetoes } from '../../../common/matchmaking'
import { MatchmakingMapPool } from '../../../common/matchmaking/matchmaking-map-pools'

/**
 * Returns a list of selected map IDs filtered to match the current map pool (and within the limit
 * of the current pool's max veto count if the selections are vetoes).
 */
export function filterMapSelections(
  mapPool: ReadonlyDeep<MatchmakingMapPool>,
  selectedMapIds: ReadonlyArray<SbMapId> = [],
): SbMapId[] {
  const result = selectedMapIds.filter(id => mapPool.maps.includes(id))
  return hasVetoes(mapPool.matchmakingType) ? result.slice(0, mapPool.maxVetoCount) : result
}
