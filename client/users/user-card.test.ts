import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { LadderPlayer, ladderPlayerToMatchmakingDivision } from '../../common/ladder/ladder'
import {
  getTotalBonusPoolForSeason,
  makeSeasonId,
  MatchmakingSeasonJson,
  MatchmakingType,
} from '../../common/matchmaking'
import { RaceStats } from '../../common/races'
import { asMockedFunction } from '../../common/testing/mocks'
import { makeSbUserId } from '../../common/users/sb-user-id'
import { UserProfileJson } from '../../common/users/user-network'
import { dispatch } from '../dispatch-registry'
import { fetchJson } from '../network/fetch'
import { FetchError } from '../network/fetch-errors'
import {
  getMainRace,
  getRankedModes,
  loadProfileForLink,
  resetUserLinkFetchesForTesting,
} from './user-card'

vi.mock('../network/fetch', () => ({
  fetchJson: vi.fn(),
}))
vi.mock('../dispatch-registry', () => ({
  dispatch: vi.fn(),
}))

const fetchJsonMock = asMockedFunction(fetchJson)
const dispatchMock = asMockedFunction(dispatch)

function notFoundError(): FetchError {
  return new FetchError(new Response('', { status: 404, statusText: 'Not Found' }), '')
}

function serverError(): FetchError {
  return new FetchError(new Response('', { status: 500, statusText: 'Server Error' }), '')
}

const MOCK_USER_ID = makeSbUserId(1)

const MOCK_SEASON: MatchmakingSeasonJson = {
  id: makeSeasonId(1),
  name: 'Beta Season 3',
  startDate: Date.now() - 1000 * 60 * 60 * 24 * 14,
  resetMmr: true,
}

const NO_RACE_STATS: RaceStats = {
  pWins: 0,
  pLosses: 0,
  tWins: 0,
  tLosses: 0,
  zWins: 0,
  zLosses: 0,
  rWins: 0,
  rLosses: 0,
  rPWins: 0,
  rPLosses: 0,
  rTWins: 0,
  rTLosses: 0,
  rZWins: 0,
  rZLosses: 0,
}

function makeLadderPlayer(
  matchmakingType: MatchmakingType,
  points: number,
  wins: number,
  losses: number,
  /** Games played in the mode over every season; defaults to this season's. */
  lifetimeGames = wins + losses,
): LadderPlayer {
  return {
    ...NO_RACE_STATS,
    rank: 12,
    userId: MOCK_USER_ID,
    matchmakingType,
    seasonId: MOCK_SEASON.id,
    rating: 1750,
    points,
    bonusUsed: 0,
    lifetimeGames,
    wins,
    losses,
    lastPlayedDate: Date.now() - 1000 * 60 * 60 * 3,
  }
}

function makeProfile(ladder: Partial<Record<MatchmakingType, LadderPlayer>>): UserProfileJson {
  return {
    userId: MOCK_USER_ID,
    seasonId: MOCK_SEASON.id,
    ladder,
    userStats: { ...NO_RACE_STATS, userId: MOCK_USER_ID },
  }
}

describe('client/users/user-card getRankedModes', () => {
  test('season loaded: every played mode, most-played first, with its division', () => {
    // Match2v2 is listed first in the object but has fewer total games than Match1v1, which
    // should still come first.
    const ladder = {
      [MatchmakingType.Match2v2]: makeLadderPlayer(MatchmakingType.Match2v2, 940, 18, 21),
      [MatchmakingType.Match1v1]: makeLadderPlayer(MatchmakingType.Match1v1, 1840, 74, 52),
    }
    const bonusPool = getTotalBonusPoolForSeason(new Date(), MOCK_SEASON)

    expect(getRankedModes(makeProfile(ladder), MOCK_SEASON)).toEqual([
      {
        type: MatchmakingType.Match1v1,
        division: ladderPlayerToMatchmakingDivision(ladder[MatchmakingType.Match1v1], bonusPool),
        points: 1840,
        wins: 74,
        losses: 52,
      },
      {
        type: MatchmakingType.Match2v2,
        division: ladderPlayerToMatchmakingDivision(ladder[MatchmakingType.Match2v2], bonusPool),
        points: 940,
        wins: 18,
        losses: 21,
      },
    ])
  })

  test('modes with fewer than the placement games: left out', () => {
    const ladder = {
      [MatchmakingType.Match1v1]: makeLadderPlayer(MatchmakingType.Match1v1, 1840, 3, 1),
      [MatchmakingType.Match2v2]: makeLadderPlayer(MatchmakingType.Match2v2, 940, 3, 2),
    }

    expect(getRankedModes(makeProfile(ladder), MOCK_SEASON).map(m => m.type)).toEqual([
      MatchmakingType.Match2v2,
    ])
  })

  test("modes counted by lifetime games, not this season's", () => {
    const ladder = {
      // Few games this season, but rated from earlier ones.
      [MatchmakingType.Match1v1]: makeLadderPlayer(MatchmakingType.Match1v1, 1840, 2, 1, 20),
      [MatchmakingType.Match2v2]: makeLadderPlayer(MatchmakingType.Match2v2, 940, 2, 1, 3),
    }

    expect(getRankedModes(makeProfile(ladder), MOCK_SEASON).map(m => m.type)).toEqual([
      MatchmakingType.Match1v1,
    ])
  })

  test('no ranked mode: nothing', () => {
    expect(getRankedModes(makeProfile({}), MOCK_SEASON)).toEqual([])
  })

  test('season not loaded: modes without divisions', () => {
    const ladder = {
      [MatchmakingType.Match2v2]: makeLadderPlayer(MatchmakingType.Match2v2, 940, 18, 21),
      [MatchmakingType.Match1v1]: makeLadderPlayer(MatchmakingType.Match1v1, 1840, 74, 52),
    }

    const result = getRankedModes(makeProfile(ladder), undefined)

    expect(result.map(m => [m.type, m.division])).toEqual([
      [MatchmakingType.Match1v1, undefined],
      [MatchmakingType.Match2v2, undefined],
    ])
  })
})

describe('client/users/user-card getMainRace', () => {
  const NONE = makeProfile({}).userStats

  test('a race with at least 60% of the games is the main race', () => {
    expect(getMainRace({ ...NONE, tWins: 4, tLosses: 2, pWins: 3, zLosses: 1 })).toBe('t')
  })

  test('random counts as its own race', () => {
    expect(getMainRace({ ...NONE, rWins: 5, rLosses: 2, rPWins: 5, rTLosses: 2, zWins: 1 })).toBe(
      'r',
    )
  })

  test('no race with 60% of the games: undefined', () => {
    expect(getMainRace({ ...NONE, pWins: 34, tWins: 33, zWins: 33 })).toBeUndefined()
  })

  test('no games: undefined', () => {
    expect(getMainRace(NONE)).toBeUndefined()
  })
})

describe('client/users/user-card loadProfileForLink', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    resetUserLinkFetchesForTesting()
    fetchJsonMock.mockReset()
    dispatchMock.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const USER_A = makeSbUserId(100)

  test('shares one request across concurrent loads of the same user', async () => {
    fetchJsonMock.mockResolvedValue({})

    const results = await Promise.all([loadProfileForLink(USER_A), loadProfileForLink(USER_A)])

    expect(results).toEqual([undefined, undefined])
    expect(fetchJsonMock).toHaveBeenCalledTimes(1)
    expect(dispatchMock).toHaveBeenCalledTimes(1)
  })

  test('caches a 404', async () => {
    fetchJsonMock.mockRejectedValue(notFoundError())

    expect(await loadProfileForLink(USER_A)).toBe('notFound')
    expect(await loadProfileForLink(USER_A)).toBe('notFound')
    expect(fetchJsonMock).toHaveBeenCalledTimes(1)
    expect(dispatchMock).not.toHaveBeenCalled()
  })

  test('evicts other failures so a later load retries', async () => {
    fetchJsonMock.mockRejectedValueOnce(serverError())
    fetchJsonMock.mockResolvedValueOnce({})

    expect(await loadProfileForLink(USER_A)).toBe('error')
    expect(await loadProfileForLink(USER_A)).toBeUndefined()
    expect(fetchJsonMock).toHaveBeenCalledTimes(2)
  })

  test('denies loads past the budget without caching the denial', async () => {
    fetchJsonMock.mockResolvedValue({})

    for (let i = 0; i < 10; i++) {
      expect(await loadProfileForLink(makeSbUserId(200 + i))).toBeUndefined()
    }
    const overBudget = makeSbUserId(300)
    expect(await loadProfileForLink(overBudget)).toBe('error')
    expect(fetchJsonMock).toHaveBeenCalledTimes(10)

    vi.advanceTimersByTime(30 * 1000)
    expect(await loadProfileForLink(overBudget)).toBeUndefined()
    expect(fetchJsonMock).toHaveBeenCalledTimes(11)
  })

  test('joins an in-flight load without spending budget', async () => {
    let resolve: (value: unknown) => void = () => {}
    fetchJsonMock.mockReturnValueOnce(new Promise(r => (resolve = r)))
    const pending = loadProfileForLink(USER_A)
    fetchJsonMock.mockResolvedValue({})
    for (let i = 0; i < 9; i++) {
      await loadProfileForLink(makeSbUserId(200 + i))
    }

    const joined = loadProfileForLink(USER_A)
    resolve({})

    expect(await Promise.all([pending, joined])).toEqual([undefined, undefined])
    expect(fetchJsonMock).toHaveBeenCalledTimes(10)
  })
})
