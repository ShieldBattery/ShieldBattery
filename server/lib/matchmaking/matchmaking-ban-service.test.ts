import { beforeEach, describe, expect, test, vi } from 'vitest'
import { asMockedFunction } from '../../../common/testing/mocks'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { FakeClock } from '../time/testing/fake-clock'
import { MIN_IDENTIFIER_MATCHES } from '../users/client-ids'
import { liftMatchmakingBans, MatchmakingBanRow } from './matchmaking-ban-models'
import { MatchmakingBanService } from './matchmaking-ban-service'

vi.mock('./matchmaking-ban-models', () => ({
  addMatchmakingBan: vi.fn(),
  checkActiveMatchmakingBan: vi.fn(),
  checkUnclearedMatchmakingBan: vi.fn(),
  getLatestMatchmakingBan: vi.fn(),
  liftMatchmakingBans: vi.fn(),
  markClearedBans: vi.fn(),
}))

vi.mock('../jobs/job-scheduler', () => ({
  JobScheduler: class {
    scheduleImmediateJob() {}
  },
}))

const ADMIN = makeSbUserId(1)
const TARGET = makeSbUserId(2)

const NOW = 1_700_000_000_000

describe('matchmaking/matchmaking-ban-service/liftBans', () => {
  let clock: FakeClock
  let service: MatchmakingBanService

  beforeEach(() => {
    vi.clearAllMocks()
    clock = new FakeClock()
    clock.setCurrentTime(NOW)
    service = new MatchmakingBanService(clock)
  })

  test('lifts bans applying to the user at the current time, recording who and why', async () => {
    const lifted: MatchmakingBanRow[] = [
      {
        id: 'ban-id',
        identifierType: 1,
        identifierHash: Buffer.from('hash'),
        triggeredBy: TARGET,
        banLevel: 2,
        createdAt: new Date(NOW - 60_000),
        expiresAt: new Date(NOW),
        clearsAt: new Date(NOW),
        liftedBy: ADMIN,
        liftedAt: new Date(NOW),
        liftReason: 'crashed',
      },
    ]
    asMockedFunction(liftMatchmakingBans).mockResolvedValue(lifted)

    const result = await service.liftBans({ userId: TARGET, liftedBy: ADMIN, reason: 'crashed' })

    expect(result).toBe(lifted)
    expect(liftMatchmakingBans).toHaveBeenCalledWith({
      userId: TARGET,
      minSameIdentifiers: MIN_IDENTIFIER_MATCHES,
      liftedBy: ADMIN,
      reason: 'crashed',
      now: new Date(NOW),
    })
  })
})
