import { describe, expect, test } from 'vitest'
import { GameType } from '../../common/games/game-type'
import { MatchmakingType } from '../../common/matchmaking'
import {
  groupMatchupSeasons,
  umsForceLayout,
  usualGameType,
  weeklyBarHeights,
} from './map-page-summaries'

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

describe('maps/map-page-summaries/usualGameType', () => {
  test('returns the top type when other types are played too', () => {
    expect(
      usualGameType(
        [
          { gameType: GameType.TopVsBottom, games: 62 },
          { gameType: GameType.Melee, games: 38 },
        ],
        GameType.Melee,
      ),
    ).toEqual({ gameType: GameType.TopVsBottom, share: 0.62 })
  })

  test('returns the top type when it is the only one but not the default', () => {
    expect(
      usualGameType([{ gameType: GameType.UseMapSettings, games: 40 }], GameType.Melee),
    ).toEqual({ gameType: GameType.UseMapSettings, share: 1 })
  })

  test('returns nothing when every game uses the default type', () => {
    expect(usualGameType([{ gameType: GameType.Melee, games: 40 }], GameType.Melee)).toBeUndefined()
  })

  test('returns nothing below the minimum number of games', () => {
    expect(
      usualGameType(
        [
          { gameType: GameType.TopVsBottom, games: 5 },
          { gameType: GameType.Melee, games: 4 },
        ],
        GameType.Melee,
      ),
    ).toBeUndefined()
    expect(usualGameType([], GameType.Melee)).toBeUndefined()
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
