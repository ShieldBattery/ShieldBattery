import { RouterContext } from '@koa/router'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { League, LeagueErrorCode, makeLeagueId } from '../../../common/leagues/leagues'
import { MatchmakingType } from '../../../common/matchmaking'
import { asMockedFunction } from '../../../common/testing/mocks'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { DbClient } from '../db'
import transact from '../db/transaction'
import NotificationService from '../notifications/notification-service'
import { Redis } from '../redis/redis'
import { ReplayService } from '../replays/replay-service'
import { updateLeaderboards } from './leaderboard'
import { LeagueAdminApi, LeagueApi } from './league-api'
import { adminGetLeague, getLeague, leaveLeagueForUser } from './league-models'
import { LeagueStartNotifier } from './league-start-notifier'

vi.mock('../db/transaction', () => ({ default: vi.fn() }))
vi.mock('./leaderboard', () => ({ getLeaderboard: vi.fn(), updateLeaderboards: vi.fn() }))
vi.mock('./league-models', async importOriginal => ({
  ...(await importOriginal<typeof import('./league-models')>()),
  getLeague: vi.fn(),
  adminGetLeague: vi.fn(),
  leaveLeagueForUser: vi.fn(),
}))

const NOW = new Date('2026-10-18T20:00:00.000Z')
const LEAGUE_ID = makeLeagueId('00000000-0000-4000-8000-000000000001')
const USER_ID = makeSbUserId(2)
const redis = {} as Redis
const client = {} as DbClient

function makeLeague(overrides: Partial<League> = {}): League {
  return {
    id: LEAGUE_ID,
    name: 'Test league',
    description: 'Test league',
    matchmakingType: MatchmakingType.Match1v1,
    signupsAfter: new Date(Number(NOW) - 2000),
    startAt: new Date(Number(NOW) - 1000),
    endAt: new Date(Number(NOW) + 1000),
    ...overrides,
  }
}

function makeContext(): RouterContext {
  return {
    params: { leagueId: LEAGUE_ID },
    session: { user: { id: USER_ID } },
  } as unknown as RouterContext
}

describe('league membership removal deadlines', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    asMockedFunction(transact).mockImplementation(fn => fn(client))
    asMockedFunction(getLeague).mockResolvedValue(makeLeague())
    asMockedFunction(leaveLeagueForUser).mockResolvedValue()
    asMockedFunction(updateLeaderboards).mockResolvedValue()
  })

  afterEach(() => vi.useRealTimers())

  test.each([0, -1, -86_400_000])(
    'rejects self-removal when the league ended %i ms from now',
    async endOffset => {
      asMockedFunction(getLeague).mockResolvedValue(
        makeLeague({ endAt: new Date(Number(NOW) + endOffset) }),
      )
      const api = new LeagueApi(redis, {} as ReplayService)

      await expect(api.leaveLeague(makeContext())).rejects.toMatchObject({
        code: LeagueErrorCode.AlreadyEnded,
      })

      expect(transact).not.toHaveBeenCalled()
      expect(leaveLeagueForUser).not.toHaveBeenCalled()
      expect(updateLeaderboards).not.toHaveBeenCalled()
    },
  )

  test.each([false, true])(
    'allows self-removal before the deadline (league not started: %s)',
    async future => {
      asMockedFunction(getLeague).mockResolvedValue(
        makeLeague({ startAt: new Date(Number(NOW) + (future ? 500 : -1000)) }),
      )
      const api = new LeagueApi(redis, {} as ReplayService)

      await api.leaveLeague(makeContext())

      expect(getLeague).toHaveBeenCalledWith(LEAGUE_ID, NOW)
      expect(leaveLeagueForUser).toHaveBeenCalledWith(LEAGUE_ID, USER_ID, client)
      expect(updateLeaderboards).toHaveBeenCalledWith(
        redis,
        [{ leagueId: LEAGUE_ID, userId: USER_ID }],
        client,
      )
    },
  )

  test('does not modify a membership if the league is missing', async () => {
    asMockedFunction(getLeague).mockResolvedValue(undefined)
    const api = new LeagueApi(redis, {} as ReplayService)

    await expect(api.leaveLeague(makeContext())).rejects.toMatchObject({
      code: LeagueErrorCode.NotFound,
    })

    expect(transact).not.toHaveBeenCalled()
  })

  test('admins can still remove users from completed leagues', async () => {
    asMockedFunction(adminGetLeague).mockResolvedValue(
      makeLeague({ endAt: new Date(Number(NOW) - 1000) }),
    )
    const api = new LeagueAdminApi({} as NotificationService, {} as LeagueStartNotifier, redis)
    const context = makeContext()
    context.params.userId = String(USER_ID)

    await api.removeUserFromLeague(context)

    expect(leaveLeagueForUser).toHaveBeenCalledWith(LEAGUE_ID, USER_ID, client)
    expect(updateLeaderboards).toHaveBeenCalledWith(
      redis,
      [{ leagueId: LEAGUE_ID, userId: USER_ID }],
      client,
    )
  })
})
