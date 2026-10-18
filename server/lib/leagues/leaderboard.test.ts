import { beforeEach, describe, expect, test, vi } from 'vitest'
import { makeLeagueId } from '../../../common/leagues/leagues'
import { asMockedFunction } from '../../../common/testing/mocks'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { DbClient } from '../db'
import transact from '../db/transaction'
import { Redis } from '../redis/redis'
import { updateLeaderboards } from './leaderboard'
import { getLeagueLeaderboardEntriesWithLock } from './league-models'

vi.mock('../db/transaction', () => ({ default: vi.fn() }))
vi.mock('./league-models', () => ({ getLeagueLeaderboardEntriesWithLock: vi.fn() }))

const leagueId = makeLeagueId('00000000-0000-0000-0000-000000000001')
const userId = makeSbUserId(1)
const client = {} as DbClient
const pipeline = { zAdd: vi.fn(), zRem: vi.fn(), execAsPipeline: vi.fn() }
const redis = { client: { multi: () => pipeline } } as unknown as Redis

describe('league leaderboard membership changes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    asMockedFunction(transact).mockImplementation(fn => fn(client))
    asMockedFunction(getLeagueLeaderboardEntriesWithLock).mockResolvedValue([
      {
        leagueId,
        userId,
        points: 20,
        leftAt: null,
        lastPlayedDate: new Date(),
      },
    ])
  })

  test('uses current DB points when a delayed result carries a stale score', async () => {
    const stale = { leagueId, userId, points: 200 }
    await updateLeaderboards(redis, [stale])
    expect(getLeagueLeaderboardEntriesWithLock).toHaveBeenCalledWith([stale], client)
    expect(pipeline.zAdd).toHaveBeenCalledWith(`leaderboard:${leagueId}`, { score: 20, value: '1' })
    expect(pipeline.execAsPipeline).toHaveBeenCalledOnce()
  })

  test.each([
    { leftAt: new Date(), lastPlayedDate: new Date() },
    { leftAt: null, lastPlayedDate: null },
  ])(
    'removes departed or freshly rejoined players despite delayed cache writes: %o',
    async state => {
      asMockedFunction(getLeagueLeaderboardEntriesWithLock).mockResolvedValue([
        {
          leagueId,
          userId,
          points: 0,
          ...state,
        },
      ])
      await updateLeaderboards(redis, [{ leagueId, userId }], client)
      expect(transact).not.toHaveBeenCalled()
      expect(pipeline.zRem).toHaveBeenCalledWith(`leaderboard:${leagueId}`, '1')
      expect(pipeline.zAdd).not.toHaveBeenCalled()
    },
  )

  test('does no work for an empty update', async () => {
    await updateLeaderboards(redis, [])
    expect(transact).not.toHaveBeenCalled()
    expect(getLeagueLeaderboardEntriesWithLock).not.toHaveBeenCalled()
  })
})
