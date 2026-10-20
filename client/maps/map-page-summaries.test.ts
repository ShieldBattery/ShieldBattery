import { describe, expect, test } from 'vitest'
import { MatchmakingType } from '../../common/matchmaking'
import { groupMatchupSeasons, umsForceLayout, weeklyBarHeights } from './map-page-summaries'

const human = { isComputer: false }
const computer = { isComputer: true }

describe('maps/map-page-summaries/umsForceLayout', () => {
  test('splits humans by force', () => {
    expect(
      umsForceLayout([
        { players: [human] },
        { players: [human, human, human, human, human, human] },
      ]),
    ).toEqual({ teams: [1, 6], computers: 0 })
  })

  test('counts computers across forces and skips forces without humans', () => {
    expect(
      umsForceLayout([
        { players: [human, human, human, human] },
        { players: [computer, computer] },
      ]),
    ).toEqual({ teams: [4], computers: 2 })
  })

  test('says nothing for a single force of humans', () => {
    expect(umsForceLayout([{ players: [human, human, human] }])).toBeUndefined()
  })

  test('says nothing for a map without human players', () => {
    expect(umsForceLayout([{ players: [computer] }])).toBeUndefined()
    expect(umsForceLayout([])).toBeUndefined()
  })
})

describe('maps/map-page-summaries/groupMatchupSeasons', () => {
  test('groups seasons by type in canonical type order, newest season first', () => {
    expect(
      groupMatchupSeasons([
        { seasonId: 6, matchmakingType: MatchmakingType.Match2v2 },
        { seasonId: 6, matchmakingType: MatchmakingType.Match1v1 },
        { seasonId: 7, matchmakingType: MatchmakingType.Match1v1 },
        { seasonId: 7, matchmakingType: MatchmakingType.Match1v1 },
      ]),
    ).toEqual([
      { type: MatchmakingType.Match1v1, seasonIds: [7, 6] },
      { type: MatchmakingType.Match2v2, seasonIds: [6] },
    ])
  })

  test('is empty without seasons', () => {
    expect(groupMatchupSeasons([])).toEqual([])
  })
})

describe('maps/map-page-summaries/weeklyBarHeights', () => {
  test('scales weeks against the busiest one', () => {
    expect(weeklyBarHeights([0, 5, 10])).toEqual([0, 0.5, 1])
  })

  test('is all zeros without games', () => {
    expect(weeklyBarHeights([0, 0])).toEqual([0, 0])
    expect(weeklyBarHeights([])).toEqual([])
  })
})
