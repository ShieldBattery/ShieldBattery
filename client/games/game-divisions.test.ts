import { describe, expect, test, vi } from 'vitest'
import {
  CURRENT_DIVISION_TABLE_VERSION,
  makeSeasonId,
  MatchmakingDivision,
  MatchmakingSeasonJson,
  MatchmakingType,
  NUM_PLACEMENT_MATCHES,
  PublicMatchmakingRatingChangeJson,
} from '../../common/matchmaking'
import { makeSbUserId } from '../../common/users/sb-user-id'
import { getDivisionsForGame } from './game-divisions'

// The division helper reads the season loader from the link card; nothing here fetches.
vi.mock('./game-link-card', () => ({
  findSeasonAt: vi.fn(),
  loadMatchmakingSeasons: vi.fn(),
}))

const SEASON: MatchmakingSeasonJson = {
  id: makeSeasonId(1),
  startDate: 0,
  name: 'Season',
  resetMmr: false,
  divisionTableVersion: CURRENT_DIVISION_TABLE_VERSION,
}

function change(
  userId: number,
  overrides: Partial<PublicMatchmakingRatingChangeJson> = {},
): PublicMatchmakingRatingChangeJson {
  return {
    userId: makeSbUserId(userId),
    matchmakingType: MatchmakingType.Match1v1,
    gameId: 'game',
    points: 0,
    pointsChange: 0,
    lifetimeGames: NUM_PLACEMENT_MATCHES + 10,
    ...overrides,
  } as PublicMatchmakingRatingChangeJson
}

describe('client/games/game-divisions/getDivisionsForGame', () => {
  test('is undefined without rating changes or a season', () => {
    const changes = new Map([[makeSbUserId(1), change(1)]])
    expect(getDivisionsForGame({ startTime: 1000 }, undefined, SEASON)).toBeUndefined()
    expect(getDivisionsForGame({ startTime: 1000 }, changes, undefined)).toBeUndefined()
  })

  test('places each player by their points going into the game', () => {
    const changes = new Map([
      // Still in placements going into the game.
      [makeSbUserId(1), change(1, { lifetimeGames: NUM_PLACEMENT_MATCHES })],
      [makeSbUserId(2), change(2, { points: 100, pointsChange: 100 })],
    ])

    const divisions = getDivisionsForGame({ startTime: 1000 }, changes, SEASON)

    expect(divisions?.get(makeSbUserId(1))).toBe(MatchmakingDivision.Unrated)
    expect(divisions?.get(makeSbUserId(2))).toBe(MatchmakingDivision.Bronze1)
  })
})
