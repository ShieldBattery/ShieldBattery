import { ReadonlyDeep } from 'type-fest'
import { hasVetoes, MatchmakingMapPool } from '../../../common/matchmaking'

/**
 * Returns a list of selected map IDs filtered to match the current map pool (and within the limit
 * of the current pool's max veto count if the selections are vetoes).
 */
export function filterMapSelections(
  mapPool: ReadonlyDeep<MatchmakingMapPool>,
  selectedMapIds: ReadonlyArray<string> = [],
): string[] {
  const result = selectedMapIds.filter(m => mapPool.maps.includes(m))
  return hasVetoes(mapPool.matchmakingType) ? result.slice(0, mapPool.maxVetoCount) : result
}
