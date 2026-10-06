import { beforeEach, describe, expect, test, vi } from 'vitest'
import { NotificationType } from '../../../common/notifications'
import { FakeNotificationService } from '../notifications/testing/notification-service'

const {
  claimStartedLeaguesForNotification,
  getUnbannedLeagueUserIds,
  releaseLeagueStartNotificationClaim,
} = vi.hoisted(() => ({
  claimStartedLeaguesForNotification: vi.fn(),
  getUnbannedLeagueUserIds: vi.fn(),
  releaseLeagueStartNotificationClaim: vi.fn(),
}))

vi.mock('./league-models', () => ({
  claimStartedLeaguesForNotification,
  getUnbannedLeagueUserIds,
  releaseLeagueStartNotificationClaim,
}))
vi.mock('../logging/logger', () => ({ default: { info: vi.fn(), error: vi.fn() } }))

import { LeagueStartNotificationJob } from './league-start-notification-job'

const NOW = 1_000_000

function makeJob() {
  const jobScheduler = { scheduleImmediateJob: vi.fn() }
  const notificationService = new FakeNotificationService()
  const job = new LeagueStartNotificationJob(
    jobScheduler as any,
    { now: () => NOW } as any,
    notificationService as any,
  )
  return { job, jobScheduler, notificationService }
}

describe('leagues/league-start-notification-job', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    claimStartedLeaguesForNotification.mockResolvedValue([])
    getUnbannedLeagueUserIds.mockResolvedValue([])
    releaseLeagueStartNotificationClaim.mockResolvedValue(undefined)
  })

  test('schedules itself to run periodically', () => {
    const { job, jobScheduler } = makeJob()
    expect(jobScheduler.scheduleImmediateJob).toHaveBeenCalledTimes(1)
    const [jobId, intervalMs, jobFn] = jobScheduler.scheduleImmediateJob.mock.calls[0]
    expect(jobId).toBe('lib/leagues#leagueStartNotifications')
    expect(intervalMs).toBeGreaterThan(0)

    const spy = vi.spyOn(job, 'notifyStartedLeagues').mockResolvedValue()
    jobFn()
    expect(spy).toHaveBeenCalled()
  })

  test('claims leagues that started as of the current time', async () => {
    const { job, notificationService } = makeJob()
    await job.notifyStartedLeagues()

    expect(claimStartedLeaguesForNotification).toHaveBeenCalledWith(new Date(NOW))
    expect(notificationService.addNotificationForUsers).not.toHaveBeenCalled()
  })

  test('notifies the unbanned members of each started league', async () => {
    claimStartedLeaguesForNotification.mockResolvedValue([
      { id: 'league-a', name: 'League A', endAt: new Date(NOW + 1000) },
      { id: 'league-b', name: 'League B', endAt: new Date(NOW + 1000) },
    ])
    getUnbannedLeagueUserIds.mockImplementation(async (id: string) =>
      id === 'league-a' ? [1, 2] : [3],
    )
    const { job, notificationService } = makeJob()

    await job.notifyStartedLeagues()

    expect(getUnbannedLeagueUserIds).toHaveBeenCalledWith('league-a')
    expect(getUnbannedLeagueUserIds).toHaveBeenCalledWith('league-b')
    expect(notificationService.addNotificationForUsers).toHaveBeenCalledWith({
      userIds: [1, 2],
      data: { type: NotificationType.LeagueStart, leagueName: 'League A' },
    })
    expect(notificationService.addNotificationForUsers).toHaveBeenCalledWith({
      userIds: [3],
      data: { type: NotificationType.LeagueStart, leagueName: 'League B' },
    })
    expect(releaseLeagueStartNotificationClaim).not.toHaveBeenCalled()
  })

  test('does not notify for a league that has already ended', async () => {
    claimStartedLeaguesForNotification.mockResolvedValue([
      { id: 'league-a', name: 'League A', endAt: new Date(NOW) },
    ])
    getUnbannedLeagueUserIds.mockResolvedValue([1])
    const { job, notificationService } = makeJob()

    await job.notifyStartedLeagues()

    expect(notificationService.addNotificationForUsers).not.toHaveBeenCalled()
    expect(releaseLeagueStartNotificationClaim).not.toHaveBeenCalled()
  })

  test('releases the claim when sending fails, and continues with other leagues', async () => {
    claimStartedLeaguesForNotification.mockResolvedValue([
      { id: 'league-a', name: 'League A', endAt: new Date(NOW + 1000) },
      { id: 'league-b', name: 'League B', endAt: new Date(NOW + 1000) },
    ])
    getUnbannedLeagueUserIds.mockResolvedValue([1])
    const { job, notificationService } = makeJob()
    notificationService.addNotificationForUsers
      .mockRejectedValueOnce(new Error('db unavailable'))
      .mockResolvedValueOnce(undefined)

    await job.notifyStartedLeagues()

    expect(releaseLeagueStartNotificationClaim).toHaveBeenCalledTimes(1)
    expect(releaseLeagueStartNotificationClaim).toHaveBeenCalledWith('league-a')
    expect(notificationService.addNotificationForUsers).toHaveBeenCalledTimes(2)
  })

  test('does not throw if releasing the claim also fails', async () => {
    claimStartedLeaguesForNotification.mockResolvedValue([
      { id: 'league-a', name: 'League A', endAt: new Date(NOW + 1000) },
    ])
    getUnbannedLeagueUserIds.mockRejectedValue(new Error('db unavailable'))
    releaseLeagueStartNotificationClaim.mockRejectedValue(new Error('db unavailable'))
    const { job } = makeJob()

    await expect(job.notifyStartedLeagues()).resolves.toBeUndefined()
  })
})
