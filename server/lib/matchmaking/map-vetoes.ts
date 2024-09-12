import { ReadonlyDeep } from 'type-fest'
import { MatchmakingMapPool } from '../../../common/matchmaking.js'

/**
 * Returns a list of vetoed map IDs filtered to match the current map pool (and within the limit of
 * the current pool's max veto count).
 */
export function filterVetoedMaps(
  mapPool: ReadonlyDeep<MatchmakingMapPool>,
  vetoedMapIds: ReadonlyArray<string> = [],
): string[] {
  return vetoedMapIds.filter(m => mapPool.maps.includes(m)).slice(0, mapPool.maxVetoCount)
}
