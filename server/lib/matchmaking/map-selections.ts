import { ReadonlyDeep } from 'type-fest'
import { intersection, subtract } from '../../../common/data-structures/sets'
import { SbMapId } from '../../../common/maps'
import { hasVetoes, MapSelectionStyle } from '../../../common/matchmaking'
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

/**
 * Computes the set of maps a match could be played on, given the mode's map-selection style and each
 * participating entity's map selections. A single map is then chosen at random from this set.
 *
 * - `veto`: each entity's selections are vetoes and are removed from the pool. If every map ends up
 *   vetoed, fall back to the least-vetoed maps so a match can still form.
 * - `pick`: each entity's selections are positive picks; the candidates are the intersection of all
 *   entities' selections (the maps everyone is willing to play).
 * - `fixed`: players don't choose maps. The match always uses the mode's configured pool regardless
 *   of player input, so the candidates are the full pool. A true single-map mode simply has a
 *   one-map pool; this is modeled internally as a pick that's made automatically for the players.
 */
export function computeMatchMapCandidates(
  style: MapSelectionStyle,
  fullMapPool: ReadonlyArray<SbMapId>,
  entityMapSelections: ReadonlyArray<ReadonlyArray<SbMapId>>,
): Set<SbMapId> {
  if (style === 'fixed') {
    return new Set(fullMapPool)
  }

  if (style === 'pick') {
    let pool = new Set(fullMapPool)
    for (const selections of entityMapSelections) {
      pool = intersection(pool, new Set(selections))
    }
    return pool
  }

  // Veto
  let pool = new Set(fullMapPool)
  const vetoCount = new Map<SbMapId, number>()
  for (const selections of entityMapSelections) {
    pool = subtract(pool, selections)
    for (const map of selections) {
      vetoCount.set(map, (vetoCount.get(map) ?? 0) + 1)
    }
  }

  if (!pool.size) {
    // All available maps were vetoed; build a final pool from the least-vetoed maps. We know every
    // map in the original pool has a veto entry here (the whole pool was vetoed), so the sorted list
    // is non-empty.
    const sortedByVetoCount = Array.from(vetoCount.entries()).sort((a, b) => a[1] - b[1])
    const leastVetoCount = sortedByVetoCount[0][1]
    let lastElem = 1
    while (
      lastElem < sortedByVetoCount.length &&
      sortedByVetoCount[lastElem][1] <= leastVetoCount
    ) {
      lastElem += 1
    }

    pool = new Set(sortedByVetoCount.slice(0, lastElem).map(e => e[0]))
  }

  return pool
}
