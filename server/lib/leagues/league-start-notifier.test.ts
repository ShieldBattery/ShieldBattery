import { beforeEach, describe, expect, test, vi } from 'vitest'
import { NotificationType } from '../../../common/notifications'
import { FakeNotificationService } from '../notifications/testing/notification-service'

const {
  claimLeagueStartNotification,
  getLeaguesPendingStartNotification,
  getUnbannedLeagueUserIds,
  releaseLeagueStartNotificationClaim,
} = vi.hoisted(() => ({
  claimLeagueStartNotification: vi.fn(),
  getLeaguesPendingStartNotification: vi.fn(),
  getUnbannedLeagueUserIds: vi.fn(),
  releaseLeagueStartNotificationClaim: vi.fn(),
}))

vi.mock('./league-models', () => ({
  claimLeagueStartNotification,
  getLeaguesPendingStartNotification,
  getUnbannedLeagueUserIds,
  releaseLeagueStartNotificationClaim,
}))
vi.mock('../logging/logger', () => ({ default: { info: vi.fn(), error: vi.fn() } }))

import { LeagueStartNotifier } from './league-start-notifier'

const NOW = 1_000_000
const LEAGUE_ID = 'league-a' as any

function makeNotifier() {
  const jobScheduler = { scheduleJob: vi.fn() }
  const notificationService = new FakeNotificationService()
  const notifier = new LeagueStartNotifier(
    jobScheduler as any,
    { now: () => NOW } as any,
    notificationService as any,
  )
  return { notifier, jobScheduler, notificationService }
}

describe('leagues/league-start-notifier', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getLeaguesPendingStartNotification.mockResolvedValue([])
    claimLeagueStartNotification.mockResolvedValue(undefined)
    getUnbannedLeagueUserIds.mockResolvedValue([])
    releaseLeagueStartNotificationClaim.mockResolvedValue(undefined)
  })

  test('schedules every pending league on construction', async () => {
    getLeaguesPendingStartNotification.mockResolvedValue([
      { id: 'future', startAt: new Date(NOW + 5000) },
      { id: 'missed', startAt: new Date(NOW - 5000) },
    ])
    const { jobScheduler } = makeNotifier()
    await vi.waitFor(() => expect(jobScheduler.scheduleJob).toHaveBeenCalledTimes(2))

    const calls = jobScheduler.scheduleJob.mock.calls
    expect(calls[0].slice(0, 3)).toEqual([
      'lib/leagues#leagueStartNotification/future',
      new Date(NOW + 5000),
      -1,
    ])
    // A start time that already passed runs right away rather than in the past
    expect(calls[1].slice(0, 3)).toEqual([
      'lib/leagues#leagueStartNotification/missed',
      new Date(NOW),
      -1,
    ])
  })

  test('the scheduled job notifies the league', async () => {
    const { notifier, jobScheduler } = makeNotifier()
    const spy = vi.spyOn(notifier, 'notifyLeague').mockResolvedValue()
    notifier.scheduleLeague(LEAGUE_ID, new Date(NOW + 5000))

    const jobFn = jobScheduler.scheduleJob.mock.calls[0][3]
    await jobFn()
    expect(spy).toHaveBeenCalledWith(LEAGUE_ID)
  })

  test('notifies the unbanned members of a started league', async () => {
    claimLeagueStartNotification.mockResolvedValue({
      name: 'League A',
      endAt: new Date(NOW + 1000),
    })
    getUnbannedLeagueUserIds.mockResolvedValue([1, 2])
    const { notifier, notificationService } = makeNotifier()

    await notifier.notifyLeague(LEAGUE_ID)

    expect(claimLeagueStartNotification).toHaveBeenCalledWith(LEAGUE_ID, new Date(NOW))
    expect(getUnbannedLeagueUserIds).toHaveBeenCalledWith(LEAGUE_ID)
    expect(notificationService.addNotificationForUsers).toHaveBeenCalledWith({
      userIds: [1, 2],
      data: { type: NotificationType.LeagueStart, leagueName: 'League A' },
    })
    expect(releaseLeagueStartNotificationClaim).not.toHaveBeenCalled()
  })

  test('does nothing if the league could not be claimed', async () => {
    const { notifier, notificationService } = makeNotifier()

    await notifier.notifyLeague(LEAGUE_ID)

    expect(getUnbannedLeagueUserIds).not.toHaveBeenCalled()
    expect(notificationService.addNotificationForUsers).not.toHaveBeenCalled()
  })

  test('does not notify for a league that has already ended', async () => {
    claimLeagueStartNotification.mockResolvedValue({ name: 'League A', endAt: new Date(NOW) })
    const { notifier, notificationService } = makeNotifier()

    await notifier.notifyLeague(LEAGUE_ID)

    expect(notificationService.addNotificationForUsers).not.toHaveBeenCalled()
    expect(releaseLeagueStartNotificationClaim).not.toHaveBeenCalled()
  })

  test('releases the claim and retries later when sending fails', async () => {
    claimLeagueStartNotification.mockResolvedValue({
      name: 'League A',
      endAt: new Date(NOW + 1000),
    })
    const { notifier, jobScheduler, notificationService } = makeNotifier()
    notificationService.addNotificationForUsers.mockRejectedValueOnce(new Error('db unavailable'))

    await notifier.notifyLeague(LEAGUE_ID)

    expect(releaseLeagueStartNotificationClaim).toHaveBeenCalledWith(LEAGUE_ID)
    expect(jobScheduler.scheduleJob).toHaveBeenCalledTimes(1)
    const [jobId, startTime, runEveryMs] = jobScheduler.scheduleJob.mock.calls[0]
    expect(jobId).toBe('lib/leagues#leagueStartNotification/league-a')
    expect(Number(startTime)).toBeGreaterThan(NOW)
    expect(runEveryMs).toBe(-1)
  })

  test('does not throw or retry if releasing the claim also fails', async () => {
    claimLeagueStartNotification.mockResolvedValue({
      name: 'League A',
      endAt: new Date(NOW + 1000),
    })
    getUnbannedLeagueUserIds.mockRejectedValue(new Error('db unavailable'))
    releaseLeagueStartNotificationClaim.mockRejectedValue(new Error('db unavailable'))
    const { notifier, jobScheduler } = makeNotifier()

    await expect(notifier.notifyLeague(LEAGUE_ID)).resolves.toBeUndefined()
    expect(jobScheduler.scheduleJob).not.toHaveBeenCalled()
  })
})
