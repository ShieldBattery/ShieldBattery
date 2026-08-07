import { describe, expect, test } from 'vitest'
import { AssignedRaceChar } from '../../common/races'
import { MatchupFilters } from './matchup-data'
import { MatchupModeData, createMatchupSource } from './matchup-source'
import { ALL_MAPS, ALL_SEASONS } from './stats-filters'

const MAP_A = 'map-a'
const MAP_B = 'map-b'

function bucket(
  seasonId: number,
  mapId: string,
  races: AssignedRaceChar[],
  opponentRaces: AssignedRaceChar[],
  games: number,
  wins: number,
  ratingBand = 1400,
) {
  return { seasonId, mapId, races, opponentRaces, ratingBand, games, wins }
}

/** Map names only, sorted -- most tests care which maps are in the pool, not their images. */
function names(maps: ReadonlyArray<{ name: string }>): string[] {
  return maps.map(m => m.name).sort()
}

/** Every filter wide open, which each test then narrows one dimension of. */
const ALL: MatchupFilters = { season: ALL_SEASONS, map: ALL_MAPS, ratingRange: [1000, 2400] }

const MODE: MatchupModeData = {
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
    const source = createMatchupSource(MODE)
    // 10 + 5 + 4 games of PvZ, spread over two maps and two seasons.
    expect(source.cell(ALL, ['p'], ['z'])).toEqual({ games: 19, wins: 11 })
  })

  test('keeps a matchup separate from its reverse', () => {
    // PvZ and ZvP are different cells: the second is not the first counted from the other side.
    const source = createMatchupSource(MODE)
    expect(source.cell(ALL, ['z'], ['p'])).toEqual({ games: 8, wins: 2 })
  })

  test('filters by season and by map, and the two compose', () => {
    const source = createMatchupSource(MODE)
    expect(source.cell({ ...ALL, season: '1' }, ['p'], ['z'])).toEqual({ games: 15, wins: 7 })
    expect(source.cell({ ...ALL, map: 'Alpha' }, ['p'], ['z'])).toEqual({ games: 14, wins: 10 })
    expect(source.cell({ ...ALL, season: '1', map: 'Alpha' }, ['p'], ['z'])).toEqual({
      games: 10,
      wins: 6,
    })
  })

  test('reports an unplayed cell as empty rather than as a zero-win record', () => {
    const source = createMatchupSource(MODE)
    expect(source.cell(ALL, ['t'], ['z'])).toEqual({ games: 0, wins: 0 })
  })

  test('matches a side by composition, not by the order it was given in', () => {
    // A team is identified by the races on it, so a two-race side has to compare equal whichever
    // way round each end spells it -- which is what lets one adapter serve every team mode.
    const teamMode: MatchupModeData = {
      buckets: [bucket(1, MAP_A, ['t', 'p'], ['p', 'z'], 7, 4)],
      maps: [{ id: MAP_A, name: 'Alpha' }],
    }
    const source = createMatchupSource(teamMode)
    expect(source.cell(ALL, ['p', 't'], ['z', 'p'])).toEqual({ games: 7, wins: 4 })
  })

  test('keeps a team mirror separate from the sides that make it up', () => {
    // TZ vs TZ and TZ vs TT differ only in the opposing side, which the cell lookup has to read
    // independently of the viewer's own.
    const teamMode: MatchupModeData = {
      buckets: [
        bucket(1, MAP_A, ['t', 'z'], ['t', 'z'], 6, 3),
        bucket(1, MAP_A, ['t', 'z'], ['t', 't'], 4, 1),
      ],
      maps: [{ id: MAP_A, name: 'Alpha' }],
    }
    const source = createMatchupSource(teamMode)
    expect(source.cell(ALL, ['t', 'z'], ['t', 'z'])).toEqual({ games: 6, wins: 3 })
    expect(source.cell(ALL, ['t', 'z'], ['t', 't'])).toEqual({ games: 4, wins: 1 })
  })

  test('lists only the maps that appear in the filtered buckets', () => {
    const source = createMatchupSource(MODE)
    expect(names(source.maps(ALL))).toEqual(['Alpha', 'Beta'])
    // Season 2 was only played on one map, so the picker mustn't offer the other.
    expect(names(source.maps({ ...ALL, season: '2' }))).toEqual(['Alpha'])
  })

  test('lists maps without narrowing by the map already chosen', () => {
    // The picker is populated from this, so respecting `filters.map` would leave it offering
    // only the selection it already has and no way back to the others.
    const source = createMatchupSource(MODE)
    expect(names(source.maps({ ...ALL, map: 'Alpha' }))).toEqual(['Alpha', 'Beta'])
  })

  test('carries the preview image through, and tolerates a map without a file', () => {
    // The strip draws from this; a map whose file is gone still has to appear, with its record.
    const source = createMatchupSource({
      buckets: [bucket(1, MAP_A, ['p'], ['z'], 3, 2), bucket(1, MAP_B, ['p'], ['z'], 4, 1)],
      maps: [
        { id: MAP_A, name: 'Alpha', mapFile: { image256Url: 'alpha.jpg' } },
        { id: MAP_B, name: 'Beta', mapFile: null },
      ],
    })
    expect(source.maps(ALL).sort((a, b) => a.name.localeCompare(b.name))).toEqual([
      { name: 'Alpha', imageUrl: 'alpha.jpg' },
      { name: 'Beta', imageUrl: undefined },
    ])
  })

  test('map stats total every cell on that map', () => {
    const source = createMatchupSource(MODE)
    // Alpha: 10+4 PvZ, 8 ZvP, 3 TvT.
    expect(source.mapStats({ ...ALL, map: 'Alpha' })).toEqual({ games: 25, wins: 13 })
    expect(source.mapStats({ ...ALL, map: 'Beta' })).toEqual({ games: 5, wins: 1 })
  })

  describe('rating range', () => {
    const banded: MatchupModeData = {
      buckets: [
        bucket(1, MAP_A, ['p'], ['z'], 10, 6, 1200),
        bucket(1, MAP_A, ['p'], ['z'], 20, 9, 1600),
        bucket(1, MAP_A, ['p'], ['z'], 4, 3, 2400),
      ],
      maps: [{ id: MAP_A, name: 'Alpha' }],
    }

    test('sums every band when the range spans the whole grid', () => {
      const source = createMatchupSource(banded)
      expect(source.cell(ALL, ['p'], ['z'])).toEqual({ games: 34, wins: 18 })
    })

    test('includes both ends of the range', () => {
      // The bounds are band edges, so picking 1200 includes the 1200 band rather than cutting at
      // it. Getting this wrong would silently drop a band at each end.
      const source = createMatchupSource(banded)
      expect(source.cell({ ...ALL, ratingRange: [1200, 1600] }, ['p'], ['z'])).toEqual({
        games: 30,
        wins: 15,
      })
    })

    test('narrows to a single band', () => {
      const source = createMatchupSource(banded)
      expect(source.cell({ ...ALL, ratingRange: [1600, 1600] }, ['p'], ['z'])).toEqual({
        games: 20,
        wins: 9,
      })
    })

    test('reports a range with no games as empty', () => {
      const source = createMatchupSource(banded)
      expect(source.cell({ ...ALL, ratingRange: [1800, 2200] }, ['p'], ['z'])).toEqual({
        games: 0,
        wins: 0,
      })
    })

    test('applies to the map picker too, so a map can drop out of the pool', () => {
      const source = createMatchupSource({
        buckets: [
          bucket(1, MAP_A, ['p'], ['z'], 10, 6, 1200),
          bucket(1, MAP_B, ['p'], ['z'], 5, 1, 2000),
        ],
        maps: [
          { id: MAP_A, name: 'Alpha' },
          { id: MAP_B, name: 'Beta' },
        ],
      })
      expect(names(source.maps({ ...ALL, ratingRange: [1000, 1400] }))).toEqual(['Alpha'])
      expect(names(source.maps({ ...ALL, ratingRange: [1800, 2400] }))).toEqual(['Beta'])
    })
  })
})
