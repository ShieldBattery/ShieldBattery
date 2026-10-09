import { describe, expect, test } from 'vitest'
import { makeSeasonId, MatchmakingSeason, MatchmakingType } from '../../../common/matchmaking'
import { TitleDivision } from '../../../common/titles'
import { getPeakDivision } from './title-models'

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
