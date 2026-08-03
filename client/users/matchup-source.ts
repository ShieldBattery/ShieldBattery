import { MatchmakingType } from '../../common/matchmaking'
import { AssignedRaceChar } from '../../common/races'
import { MatchupCell, MatchupDataSource, ModeFilter } from './matchup-data'
import { ALL_MAPS, ALL_MODES, ALL_SEASONS } from './stats-filters'

/**
 * Adapts the `userMatchupStats` buckets to the matrix's data source.
 *
 * Every filter the section offers -- mode, season, map -- is a sum over a subset of the buckets,
 * which is why the query returns them flat rather than pre-aggregated: changing a filter is
 * arithmetic here rather than another round trip.
 */

/** One mode's buckets, as they come off the query. */
export interface MatchupModeData {
  matchmakingType: MatchmakingType
  totalGames: number
  buckets: ReadonlyArray<{
    seasonId: number
    mapId: string
    races: ReadonlyArray<AssignedRaceChar>
    opponentRaces: ReadonlyArray<AssignedRaceChar>
    games: number
    wins: number
  }>
  maps: ReadonlyArray<{ id: string; name: string }>
}

/**
 * A side is identified by its composition, so `tp` and `pt` are the same team. The buckets carry
 * each side alphabetically already (that's how `assigned_matchup` stores it), but the matrix
 * builds its axes in TPZ display order, so both ends get sorted before they're compared.
 */
function sideKey(races: ReadonlyArray<AssignedRaceChar>): string {
  return [...races].sort().join('')
}

const EMPTY: MatchupCell = { games: 0, wins: 0 }

export function createMatchupSource(modes: ReadonlyArray<MatchupModeData>): MatchupDataSource {
  const mapNames = new Map<string, string>()
  for (const mode of modes) {
    for (const map of mode.maps) {
      mapNames.set(map.id, map.name)
    }
  }

  const matching = (mode: ModeFilter, season: string, map: string) => {
    const inMode = mode === ALL_MODES ? modes : modes.filter(m => m.matchmakingType === mode)
    return inMode.flatMap(m =>
      m.buckets.filter(
        b =>
          (season === ALL_SEASONS || b.seasonId === Number(season)) &&
          (map === ALL_MAPS || mapNames.get(b.mapId) === map),
      ),
    )
  }

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
    maps(mode, season) {
      // By name, since that's what the picker shows and what a map is selected by. Two maps
      // sharing a name would collapse into one option, which is the same thing a player sees.
      const names = new Set<string>()
      for (const bucket of matching(mode, season, ALL_MAPS)) {
        const name = mapNames.get(bucket.mapId)
        if (name !== undefined) names.add(name)
      }
      return Array.from(names)
    },

    mapStats(mode, season, map) {
      return total(matching(mode, season, map))
    },

    cell(mode, season, map, row, col) {
      const rowKey = sideKey(row)
      const colKey = sideKey(col)
      return total(
        matching(mode, season, map),
        b => sideKey(b.races) === rowKey && sideKey(b.opponentRaces) === colKey,
      )
    },
  }
}
