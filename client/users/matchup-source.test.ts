import { describe, expect, test } from 'vitest'
import { MatchmakingType } from '../../common/matchmaking'
import { AssignedRaceChar } from '../../common/races'
import { MatchupModeData, createMatchupSource } from './matchup-source'
import { ALL_MAPS, ALL_MODES, ALL_SEASONS } from './stats-filters'

const MAP_A = 'map-a'
const MAP_B = 'map-b'

function bucket(
  seasonId: number,
  mapId: string,
  races: AssignedRaceChar[],
  opponentRaces: AssignedRaceChar[],
  games: number,
  wins: number,
) {
  return { seasonId, mapId, races, opponentRaces, games, wins }
}

const MODE: MatchupModeData = {
  matchmakingType: MatchmakingType.Match1v1,
  totalGames: 30,
  buckets: [
    bucket(1, MAP_A, ['p'], ['z'], 10, 6),
    bucket(1, MAP_B, ['p'], ['z'], 5, 1),
    bucket(2, MAP_A, ['p'], ['z'], 4, 4),
    bucket(1, MAP_A, ['z'], ['p'], 8, 2),
    bucket(1, MAP_A, ['t'], ['t'], 3, 1),
  ],
  maps: [
    { id: MAP_A, name: 'Alpha' },
    { id: MAP_B, name: 'Beta' },
  ],
}

describe('createMatchupSource', () => {
  test('sums a cell across every season and map by default', () => {
    const source = createMatchupSource([MODE])
    // 10 + 5 + 4 games of PvZ, spread over two maps and two seasons.
    expect(source.cell(ALL_MODES, ALL_SEASONS, ALL_MAPS, ['p'], ['z'])).toEqual({
      games: 19,
      wins: 11,
    })
  })

  test('keeps a matchup separate from its reverse', () => {
    // PvZ and ZvP are different cells: the second is not the first counted from the other side.
    const source = createMatchupSource([MODE])
    expect(source.cell(ALL_MODES, ALL_SEASONS, ALL_MAPS, ['z'], ['p'])).toEqual({
      games: 8,
      wins: 2,
    })
  })

  test('filters by season and by map, and the two compose', () => {
    const source = createMatchupSource([MODE])
    expect(source.cell(ALL_MODES, '1', ALL_MAPS, ['p'], ['z'])).toEqual({ games: 15, wins: 7 })
    expect(source.cell(ALL_MODES, ALL_SEASONS, 'Alpha', ['p'], ['z'])).toEqual({
      games: 14,
      wins: 10,
    })
    expect(source.cell(ALL_MODES, '1', 'Alpha', ['p'], ['z'])).toEqual({ games: 10, wins: 6 })
  })

  test('reports an unplayed cell as empty rather than as a zero-win record', () => {
    const source = createMatchupSource([MODE])
    expect(source.cell(ALL_MODES, ALL_SEASONS, ALL_MAPS, ['t'], ['z'])).toEqual({
      games: 0,
      wins: 0,
    })
  })

  test('matches a side by composition, not by the order it was given in', () => {
    // The matrix builds its axes in TPZ order while the buckets arrive alphabetical, so a
    // two-race side has to compare equal either way round. This is what lets the same adapter
    // serve team modes once the resolver can attribute them.
    const teamMode: MatchupModeData = {
      matchmakingType: MatchmakingType.Match2v2,
      totalGames: 7,
      buckets: [bucket(1, MAP_A, ['p', 't'], ['p', 'z'], 7, 4)],
      maps: [{ id: MAP_A, name: 'Alpha' }],
    }
    const source = createMatchupSource([teamMode])
    expect(source.cell(ALL_MODES, ALL_SEASONS, ALL_MAPS, ['t', 'p'], ['z', 'p'])).toEqual({
      games: 7,
      wins: 4,
    })
  })

  test('lists only the maps that appear in the filtered buckets', () => {
    const source = createMatchupSource([MODE])
    expect(source.maps(ALL_MODES, ALL_SEASONS).sort()).toEqual(['Alpha', 'Beta'])
    // Season 2 was only played on one map, so the picker mustn't offer the other.
    expect(source.maps(ALL_MODES, '2')).toEqual(['Alpha'])
  })

  test('map stats total every cell on that map', () => {
    const source = createMatchupSource([MODE])
    // Alpha: 10+4 PvZ, 8 ZvP, 3 TvT.
    expect(source.mapStats(ALL_MODES, ALL_SEASONS, 'Alpha')).toEqual({ games: 25, wins: 13 })
    expect(source.mapStats(ALL_MODES, ALL_SEASONS, 'Beta')).toEqual({ games: 5, wins: 1 })
  })
})
