import { describe, expect, test } from 'vitest'
import { GameType } from '../../../common/games/game-type'
import { MatchupString } from '../../../common/games/matchups'
import { makeSeasonId, MatchmakingSeason, MatchmakingType } from '../../../common/matchmaking'
import { TitleDivision } from '../../../common/titles'
import { getGameTitleCounters, getPeakDivision, TitleTrackingGame } from './title-models'

const DAY_MS = 24 * 60 * 60 * 1000

const SEASONS: MatchmakingSeason[] = [
  {
    id: makeSeasonId(2),
    startDate: new Date('2026-07-01T00:00:00Z'),
    name: 'Season 2',
    resetMmr: false,
  },
  {
    id: makeSeasonId(1),
    startDate: new Date('2026-01-01T00:00:00Z'),
    name: 'Season 1',
    resetMmr: false,
  },
]

describe('server/lib/titles/title-models#getPeakDivision', () => {
  test('is undefined without any ranked games', () => {
    expect(getPeakDivision([], SEASONS)).toBeUndefined()
  })

  test('returns the highest division across modes and seasons', () => {
    expect(
      getPeakDivision(
        [
          {
            matchmakingType: MatchmakingType.Match1v1,
            points: 3000,
            changeDate: new Date('2026-01-02T00:00:00Z'),
          },
          {
            matchmakingType: MatchmakingType.Match2v2,
            points: 4300,
            changeDate: new Date('2026-07-02T00:00:00Z'),
          },
          {
            matchmakingType: MatchmakingType.Match1v1,
            points: 1000,
            changeDate: new Date('2026-07-03T00:00:00Z'),
          },
        ],
        SEASONS,
      ),
    ).toBe(TitleDivision.Gold)
  })

  test('accounts for the bonus pool raising division bounds later in a season', () => {
    // Diamond starts at 7,280 points plus the bonus pool, which grows by 200 points a week.
    const points = 7350
    const earlyInSeason = new Date(Number(SEASONS[0].startDate) + DAY_MS)
    const lateInSeason = new Date(Number(SEASONS[0].startDate) + 70 * DAY_MS)

    expect(
      getPeakDivision(
        [{ matchmakingType: MatchmakingType.Match1v1, points, changeDate: earlyInSeason }],
        SEASONS,
      ),
    ).toBe(TitleDivision.Diamond)
    expect(
      getPeakDivision(
        [{ matchmakingType: MatchmakingType.Match1v1, points, changeDate: lateInSeason }],
        SEASONS,
      ),
    ).toBe(TitleDivision.Gold)
  })
})

describe('server/lib/titles/title-models#getGameTitleCounters', () => {
  const MINUTE_MS = 60 * 1000
  const ranked1v1: TitleTrackingGame = {
    gameType: GameType.OneVsOne,
    matchmakingType: MatchmakingType.Match1v1,
    lengthMs: 3 * MINUTE_MS,
    assignedMatchup: 'z-z' as MatchupString,
  }

  test("doesn't count games without a known outcome", () => {
    expect(getGameTitleCounters(ranked1v1, { result: 'unknown', apm: 200 })).toBeUndefined()
  })

  test('counts a quick ranked mirror win', () => {
    expect(getGameTitleCounters(ranked1v1, { result: 'win', apm: 212.4 })).toEqual({
      games: 1,
      msPlayed: 3 * MINUTE_MS,
      rankedQuickWins: 1,
      rankedMirrorWins: 1,
      rankedApmTotal: 212,
      rankedApmGames: 1,
    })
  })

  test('only counts ranked feats for wins', () => {
    expect(getGameTitleCounters(ranked1v1, { result: 'loss', apm: 180 })).toEqual({
      games: 1,
      msPlayed: 3 * MINUTE_MS,
      rankedApmTotal: 180,
      rankedApmGames: 1,
    })
  })

  test('only counts mirror wins in 1v1 with a known matchup', () => {
    expect(
      getGameTitleCounters(
        { ...ranked1v1, matchmakingType: MatchmakingType.Match2v2 },
        { result: 'win', apm: 150 },
      ),
    ).not.toHaveProperty('rankedMirrorWins')
    expect(
      getGameTitleCounters(
        { ...ranked1v1, assignedMatchup: undefined },
        { result: 'win', apm: 150 },
      ),
    ).not.toHaveProperty('rankedMirrorWins')
  })

  test('counts long ranked wins', () => {
    expect(
      getGameTitleCounters({ ...ranked1v1, lengthMs: 61 * MINUTE_MS }, { result: 'win', apm: 90 }),
    ).toMatchObject({ rankedLongWins: 1 })
  })

  test("doesn't count APM or time for ranked games that never got going", () => {
    expect(getGameTitleCounters({ ...ranked1v1, lengthMs: 0 }, { result: 'loss', apm: 0 })).toEqual(
      { games: 1 },
    )
  })

  test('counts unranked FFA wins and UMS games without ranked feats', () => {
    expect(
      getGameTitleCounters(
        { gameType: GameType.FreeForAll, lengthMs: 2 * MINUTE_MS },
        { result: 'win', apm: 100 },
      ),
    ).toEqual({ games: 1, msPlayed: 2 * MINUTE_MS, ffaWins: 1 })
    expect(
      getGameTitleCounters(
        { gameType: GameType.UseMapSettings, lengthMs: 20 * MINUTE_MS },
        { result: 'draw', apm: 100 },
      ),
    ).toEqual({ games: 1, msPlayed: 20 * MINUTE_MS, umsGames: 1 })
  })
})
