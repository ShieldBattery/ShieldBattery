import { beforeEach, describe, expect, test, vi } from 'vitest'
import { makeMapCollectionId, makeMapFamilyId } from '../../../common/maps'
import { NotificationType } from '../../../common/notifications'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { FakeNotificationService } from '../notifications/testing/notification-service'

const { claimMapFeatureNotification, releaseMapFeatureNotificationClaim } = vi.hoisted(() => ({
  claimMapFeatureNotification: vi.fn(),
  releaseMapFeatureNotificationClaim: vi.fn(),
}))

vi.mock('./map-feature-models', () => ({
  claimMapFeatureNotification,
  releaseMapFeatureNotificationClaim,
}))
vi.mock('../logging/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { MapFeatureNotifier } from './map-feature-notifier'

class FakeRedisSubscriber {
  private handlers = new Map<string, Array<(message: any) => void>>()

  subscribe = vi.fn(async (channel: string, handler: (message: any) => void) => {
    const existing = this.handlers.get(channel) ?? []
    existing.push(handler)
    this.handlers.set(channel, existing)
  })

  emit(channel: string, message: any) {
    for (const handler of this.handlers.get(channel) ?? []) {
      handler(message)
    }
  }
}

// Wednesday 11 November 2026, in the week that started on Monday 9 November
const WEEK = new Date('2026-11-09T00:00:00.000Z')
const NEXT_WEEK = new Date('2026-11-16T00:00:00.000Z')
const WEEK_AFTER_NEXT = new Date('2026-11-23T00:00:00.000Z')
const WEEK_START_JOB_ID = 'lib/maps#mapFeatureNotification/weekStart'
const RETRY_JOB_ID = 'lib/maps#mapFeatureNotification/retry'

const MAKER = makeSbUserId(7)
const FAMILY_ID = makeMapFamilyId('11111111-2222-3333-4444-555555555555')
const COLLECTION_ID = makeMapCollectionId('66666666-7777-8888-9999-000000000000')

const MAP_PICK = {
  week: WEEK,
  pick: { kind: 'map', id: FAMILY_ID, name: '\x03Fighting \x04Spirit' },
  userId: MAKER,
} as const

function makeNotifier(startAt = Date.parse('2026-11-11T12:00:00.000Z')) {
  const clock = { now: vi.fn(() => startAt) }
  const jobScheduler = { scheduleJob: vi.fn() }
  const notificationService = new FakeNotificationService()
  const redis = new FakeRedisSubscriber()
  const notifier = new MapFeatureNotifier(
    jobScheduler as any,
    clock as any,
    notificationService as any,
    redis as any,
  )
  return { notifier, clock, jobScheduler, notificationService, redis }
}

/** The calls to `scheduleJob` for a job, as `[startTime, runEveryMs, jobFn]`. */
function jobCalls(jobScheduler: { scheduleJob: ReturnType<typeof vi.fn> }, jobId: string) {
  return jobScheduler.scheduleJob.mock.calls
    .filter(call => call[0] === jobId)
    .map(call => call.slice(1) as [Date, number, () => Promise<void>])
}

describe('server/lib/maps/map-feature-notifier', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    claimMapFeatureNotification.mockResolvedValue(undefined)
    releaseMapFeatureNotificationClaim.mockResolvedValue(undefined)
  })

  test('sends once at construction when a pick is due', async () => {
    claimMapFeatureNotification.mockResolvedValueOnce(MAP_PICK)
    const { notificationService } = makeNotifier()

    await vi.waitFor(() => expect(notificationService.addNotification).toHaveBeenCalledTimes(1))
    expect(claimMapFeatureNotification).toHaveBeenCalledTimes(1)
    expect(claimMapFeatureNotification).toHaveBeenCalledWith(new Date('2026-11-11T12:00:00.000Z'))
    expect(notificationService.addNotification).toHaveBeenCalledWith({
      userId: MAKER,
      data: {
        type: NotificationType.MapFeatured,
        pick: { kind: 'map', id: FAMILY_ID, name: '\x03Fighting \x04Spirit' },
      },
    })
    expect(releaseMapFeatureNotificationClaim).not.toHaveBeenCalled()
  })

  test('schedules a one-off job for the next Monday at 00:00 UTC', () => {
    const { jobScheduler } = makeNotifier()

    const calls = jobCalls(jobScheduler, WEEK_START_JOB_ID)
    expect(calls).toHaveLength(1)
    expect(calls[0][0]).toEqual(NEXT_WEEK)
    expect(calls[0][1]).toBe(-1)
  })

  test('the Monday job sends and schedules the following Monday', async () => {
    const { jobScheduler, clock, notificationService } = makeNotifier()
    await vi.waitFor(() => expect(claimMapFeatureNotification).toHaveBeenCalledTimes(1))

    clock.now.mockReturnValue(NEXT_WEEK.getTime())
    claimMapFeatureNotification.mockResolvedValueOnce({ ...MAP_PICK, week: NEXT_WEEK })
    const [, , jobFn] = jobCalls(jobScheduler, WEEK_START_JOB_ID)[0]
    await jobFn()

    expect(claimMapFeatureNotification).toHaveBeenCalledTimes(2)
    expect(claimMapFeatureNotification).toHaveBeenLastCalledWith(NEXT_WEEK)
    expect(notificationService.addNotification).toHaveBeenCalledTimes(1)
    const calls = jobCalls(jobScheduler, WEEK_START_JOB_ID)
    expect(calls).toHaveLength(2)
    expect(calls[1][0]).toEqual(WEEK_AFTER_NEXT)
    expect(calls[1][1]).toBe(-1)
  })

  test('subscribes to mapFeature and sends on a pickChanged message', async () => {
    const { redis, notificationService } = makeNotifier()
    await vi.waitFor(() => expect(claimMapFeatureNotification).toHaveBeenCalledTimes(1))
    expect(redis.subscribe).toHaveBeenCalledWith('mapFeature', expect.any(Function))

    claimMapFeatureNotification.mockResolvedValueOnce({
      week: WEEK,
      pick: { kind: 'collection', id: COLLECTION_ID, name: 'UMS night' },
      userId: MAKER,
    })
    redis.emit('mapFeature', { type: 'pickChanged', data: { week: WEEK.toISOString() } })

    await vi.waitFor(() => expect(notificationService.addNotification).toHaveBeenCalledTimes(1))
    expect(claimMapFeatureNotification).toHaveBeenCalledTimes(2)
    expect(notificationService.addNotification).toHaveBeenCalledWith({
      userId: MAKER,
      data: {
        type: NotificationType.MapFeatured,
        pick: { kind: 'collection', id: COLLECTION_ID, name: 'UMS night' },
      },
    })
  })

  test('ignores unknown mapFeature messages', async () => {
    const { redis } = makeNotifier()
    await vi.waitFor(() => expect(claimMapFeatureNotification).toHaveBeenCalledTimes(1))

    redis.emit('mapFeature', { type: 'somethingElse', data: {} })
    await Promise.resolve()

    expect(claimMapFeatureNotification).toHaveBeenCalledTimes(1)
  })

  test('sends nothing when there is no pick to claim', async () => {
    const { notifier, notificationService, jobScheduler } = makeNotifier()

    await notifier.notifyCurrentPick()

    expect(claimMapFeatureNotification).toHaveBeenCalled()
    expect(notificationService.addNotification).not.toHaveBeenCalled()
    expect(jobCalls(jobScheduler, RETRY_JOB_ID)).toHaveLength(0)
  })

  test('sends nothing for a claimed pick with nobody to tell, and leaves it claimed', async () => {
    const { notifier, notificationService, jobScheduler } = makeNotifier()
    claimMapFeatureNotification.mockResolvedValueOnce({ ...MAP_PICK, userId: undefined })

    await notifier.notifyCurrentPick()

    expect(notificationService.addNotification).not.toHaveBeenCalled()
    expect(releaseMapFeatureNotificationClaim).not.toHaveBeenCalled()
    expect(jobCalls(jobScheduler, RETRY_JOB_ID)).toHaveLength(0)
  })

  test('releases the claim and retries in a minute when adding the notification fails', async () => {
    const now = Date.parse('2026-11-11T12:00:00.000Z')
    const { notifier, notificationService, jobScheduler } = makeNotifier(now)
    await vi.waitFor(() => expect(claimMapFeatureNotification).toHaveBeenCalledTimes(1))
    claimMapFeatureNotification.mockResolvedValueOnce(MAP_PICK)
    notificationService.addNotification.mockRejectedValueOnce(new Error('db unavailable'))

    await notifier.notifyCurrentPick()

    expect(releaseMapFeatureNotificationClaim).toHaveBeenCalledWith(WEEK, new Date(now))
    const retries = jobCalls(jobScheduler, RETRY_JOB_ID)
    expect(retries).toHaveLength(1)
    expect(retries[0][0]).toEqual(new Date(now + 60 * 1000))
    expect(retries[0][1]).toBe(-1)

    claimMapFeatureNotification.mockResolvedValueOnce(MAP_PICK)
    await retries[0][2]()
    expect(notificationService.addNotification).toHaveBeenCalledTimes(2)
    expect(jobCalls(jobScheduler, RETRY_JOB_ID)).toHaveLength(1)
  })

  test('retries in a minute when the claim itself fails', async () => {
    const now = Date.parse('2026-11-11T12:00:00.000Z')
    const { notifier, notificationService, jobScheduler } = makeNotifier(now)
    await vi.waitFor(() => expect(claimMapFeatureNotification).toHaveBeenCalledTimes(1))
    claimMapFeatureNotification.mockRejectedValueOnce(new Error('db unavailable'))

    await expect(notifier.notifyCurrentPick()).resolves.toBeUndefined()

    expect(notificationService.addNotification).not.toHaveBeenCalled()
    expect(releaseMapFeatureNotificationClaim).not.toHaveBeenCalled()
    const retries = jobCalls(jobScheduler, RETRY_JOB_ID)
    expect(retries).toHaveLength(1)
    expect(retries[0][0]).toEqual(new Date(now + 60 * 1000))
  })

  test('does not throw or retry if releasing the claim also fails', async () => {
    const { notifier, notificationService, jobScheduler } = makeNotifier()
    await vi.waitFor(() => expect(claimMapFeatureNotification).toHaveBeenCalledTimes(1))
    claimMapFeatureNotification.mockResolvedValueOnce(MAP_PICK)
    notificationService.addNotification.mockRejectedValueOnce(new Error('db unavailable'))
    releaseMapFeatureNotificationClaim.mockRejectedValueOnce(new Error('db unavailable'))

    await expect(notifier.notifyCurrentPick()).resolves.toBeUndefined()
    expect(jobCalls(jobScheduler, RETRY_JOB_ID)).toHaveLength(0)
  })
})
