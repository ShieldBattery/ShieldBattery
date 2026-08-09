import { AssignedRaceChar } from '../../common/races'
import { MatchupCell, MatchupDataSource, MatchupFilters } from './matchup-data'
import { ALL_MAPS, ALL_SEASONS } from './stats-filters'

/**
 * Adapts one mode's `userMatchupStats` buckets to the matrix's data source.
 *
 * Every filter the matrix offers below the mode -- season, map -- is a sum over a subset of the
 * buckets, which is why the query returns them flat rather than pre-aggregated: changing a filter
 * is arithmetic here rather than another round trip. The mode itself isn't one of them, since
 * changing it changes the shape of the matrix and so fetches a different set of buckets.
 */

/** One mode's buckets, as they come off the query. */
export interface MatchupModeData {
  buckets: ReadonlyArray<{
    seasonId: number
    mapId: string
    races: ReadonlyArray<AssignedRaceChar>
    opponentRaces: ReadonlyArray<AssignedRaceChar>
    /** Lower edge of the band, matching `MatchupBucket.ratingBand` on the wire. */
    ratingBand: number
    games: number
    wins: number
  }>
  maps: ReadonlyArray<{
    id: string
    name: string
    /** Absent when the map's file is gone; the strip then shows a placeholder. */
    mapFile?: { image256Url: string } | null
  }>
}

/**
 * A side is identified by its composition, so `tp` and `pt` are the same team. Both ends get
 * sorted before they're compared rather than trusting either to arrive canonical: the buckets
 * carry each side in TPZ display order, while an axis is built from `raceCombos`, and pinning
 * the comparison to one of those orders would make the other one's ordering load-bearing.
 */
function sideKey(races: ReadonlyArray<AssignedRaceChar>): string {
  return [...races].sort().join('')
}

const EMPTY: MatchupCell = { games: 0, wins: 0 }

export function createMatchupSource(mode: MatchupModeData): MatchupDataSource {
  const mapNames = new Map<string, string>()
  // Keyed by name rather than id, since that's what the filter selects by. Two uploads sharing a
  // name collapse into one entry and the first one's image stands for both -- the same collapse
  // the picker has always done, now with a picture attached.
  const imagesByName = new Map<string, string | undefined>()
  for (const map of mode.maps) {
    mapNames.set(map.id, map.name)
    if (!imagesByName.has(map.name)) {
      imagesByName.set(map.name, map.mapFile?.image256Url)
    }
  }

  const matching = ({ season, map, ratingRange }: MatchupFilters, byMap = true) =>
    mode.buckets.filter(
      b =>
        (season === ALL_SEASONS || b.seasonId === Number(season)) &&
        (!byMap || map === ALL_MAPS || mapNames.get(b.mapId) === map) &&
        // Both ends are inclusive because they're band *edges*, not raw ratings: picking 1600
        // means "include the 1600–1799 band", not "cut at exactly 1600".
        b.ratingBand >= ratingRange[0] &&
        b.ratingBand <= ratingRange[1],
    )

  const total = (
    buckets: ReadonlyArray<MatchupModeData['buckets'][number]>,
    predicate?: (b: MatchupModeData['buckets'][number]) => boolean,
  ): MatchupCell => {
    let games = 0
    let wins = 0
    for (const bucket of buckets) {
      if (predicate && !predicate(bucket)) continue
      games += bucket.games
      wins += bucket.wins
    }
    return games ? { games, wins } : EMPTY
  }

  return {
    maps(filters) {
      // By name, since that's what the picker shows and what a map is selected by. Two maps
      // sharing a name would collapse into one option, which is the same thing a player sees.
      const names = new Set<string>()
      for (const bucket of matching(filters, false)) {
        const name = mapNames.get(bucket.mapId)
        if (name !== undefined) names.add(name)
      }
      return Array.from(names, name => ({ name, imageUrl: imagesByName.get(name) }))
    },

    mapStats(filters) {
      return total(matching(filters))
    },

    cell(filters, row, col) {
      const rowKey = sideKey(row)
      const colKey = sideKey(col)
      return total(
        matching(filters),
        b => sideKey(b.races) === rowKey && sideKey(b.opponentRaces) === colKey,
      )
    },
  }
}

/**
 * Stands in while a mode's buckets are still loading, so the matrix can draw its axes and its
 * mode picker without every call site guarding for an absent source.
 */
export const EMPTY_MATCHUP_SOURCE: MatchupDataSource = createMatchupSource({
  buckets: [],
  maps: [],
})
