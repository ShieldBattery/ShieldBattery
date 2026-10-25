import { beforeEach, describe, expect, test, vi } from 'vitest'
import { asMockedFunction } from '../../../common/testing/mocks'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { DbClient } from '../db'
import { DiscordWebhookNotifier } from '../discord/webhook-notifier'
import { JobScheduler } from '../jobs/job-scheduler'
import { Clock } from '../time/clock'
import { BanEnacter } from './ban-enacter'
import {
  findPendingIdentifierReconciliations,
  finishIdentifierBan,
  finishIdentifierReconciliation,
  getGameIdentifiers,
  IdentifierReconciliation,
  pruneIdentifierObservations,
  retryIdentifierReconciliation,
  scheduleIdentifierBan,
  withIdentifierReconciliation,
} from './identifier-observation-models'
import { IdentifierReconciliationService } from './identifier-reconciliation-service'
import { RestrictionService } from './restriction-service'
import { countBannedUserIdentifiers } from './user-identifiers'
import { findUserById } from './user-model'

vi.mock('./identifier-observation-models')
vi.mock('./user-identifiers', () => ({ countBannedUserIdentifiers: vi.fn() }))
vi.mock('./user-model', () => ({ findUserById: vi.fn() }))
vi.mock('./client-ids', () => ({ MIN_IDENTIFIER_MATCHES: 4 }))

const NOW = Date.UTC(2026, 9, 24, 12)
const USER = makeSbUserId(7)
const CLIENT = {} as DbClient
const IDS: Array<[number, Buffer]> = [[2, Buffer.alloc(32, 1)]]

describe('identifier reconciliation', () => {
  let service: IdentifierReconciliationService
  let work: IdentifierReconciliation
  const handleNewIdentifiers = vi.fn()
  const enactIdentifierBanRequest = vi.fn()
  const mirrorActiveBanIdentifiers = vi.fn()
  const notify = vi.fn()
  const monotonicNow = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    work = {
      userId: USER,
      gameId: 'game',
      requestId: 'request',
      revision: '2',
      processedRevision: '1',
      actionState: 'idle',
      endTime: null,
      notBefore: null,
    }
    handleNewIdentifiers.mockResolvedValue(undefined)
    enactIdentifierBanRequest.mockResolvedValue({ status: 'banned', banId: 'ban' })
    mirrorActiveBanIdentifiers.mockResolvedValue(false)
    notify.mockResolvedValue(undefined)
    monotonicNow.mockReturnValue(0)
    asMockedFunction(findUserById).mockResolvedValue({ id: USER, name: 'Test user' } as any)
    asMockedFunction(findPendingIdentifierReconciliations).mockImplementation(async excluded =>
      excluded?.includes(work.userId) ? [] : [work],
    )
    asMockedFunction(withIdentifierReconciliation).mockImplementation(async (_, __, run) => {
      await run({ ...work }, CLIENT)
    })
    asMockedFunction(getGameIdentifiers).mockResolvedValue(IDS)
    asMockedFunction(countBannedUserIdentifiers).mockResolvedValue([0, undefined])
    asMockedFunction(pruneIdentifierObservations).mockResolvedValue({
      observations: 0,
      reconciliations: 0,
    })
    service = new IdentifierReconciliationService(
      { handleNewIdentifiers } as unknown as RestrictionService,
      { enactIdentifierBanRequest, mirrorActiveBanIdentifiers } as unknown as BanEnacter,
      { now: () => NOW, monotonicNow } as unknown as Clock,
      { scheduleImmediateJob: vi.fn() } as unknown as JobScheduler,
      { notify } as unknown as DiscordWebhookNotifier,
    )
  })

  test('prunes bounded batches until expired history is drained', async () => {
    asMockedFunction(pruneIdentifierObservations)
      .mockResolvedValueOnce({ observations: 1000, reconciliations: 0 })
      .mockResolvedValueOnce({ observations: 10, reconciliations: 1000 })
      .mockResolvedValueOnce({ observations: 0, reconciliations: 2 })
    await service.prune()
    expect(pruneIdentifierObservations).toHaveBeenCalledTimes(3)
  })

  test('limits an hourly prune to 32 batches', async () => {
    asMockedFunction(pruneIdentifierObservations).mockResolvedValue({
      observations: 1000,
      reconciliations: 1000,
    })
    await service.prune()
    expect(pruneIdentifierObservations).toHaveBeenCalledTimes(32)
  })

  test('stops pruning at the monotonic budget and can retry after failure', async () => {
    monotonicNow.mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValue(5000)
    asMockedFunction(pruneIdentifierObservations).mockResolvedValue({
      observations: 1000,
      reconciliations: 0,
    })
    await service.prune()
    expect(pruneIdentifierObservations).toHaveBeenCalledTimes(1)
    asMockedFunction(pruneIdentifierObservations).mockRejectedValueOnce(new Error('database error'))
    await expect(service.prune()).rejects.toThrow('database error')
    asMockedFunction(pruneIdentifierObservations).mockResolvedValue({
      observations: 0,
      reconciliations: 0,
    })
    await service.prune()
    expect(pruneIdentifierObservations).toHaveBeenCalledTimes(3)
  })

  function queueUsers(count: number): IdentifierReconciliation[] {
    const queued = Array.from({ length: count }, (_, i) => ({
      ...work,
      userId: makeSbUserId(i + 100),
    }))
    asMockedFunction(findPendingIdentifierReconciliations).mockImplementation(
      async (excluded = [], limit = 16) =>
        queued.filter(item => !excluded.includes(item.userId)).slice(0, limit),
    )
    asMockedFunction(withIdentifierReconciliation).mockImplementation(async (userId, _, run) => {
      await run(
        queued.find(item => item.userId === userId)!,
        CLIENT,
      )
    })
    return queued
  }

  test('drains multiple batches without revisiting accounts that receive more observations', async () => {
    const queued = queueUsers(40)
    await service.reconcile()
    expect(withIdentifierReconciliation).toHaveBeenCalledTimes(queued.length)
    expect(
      new Set(vi.mocked(withIdentifierReconciliation).mock.calls.map(call => call[0])).size,
    ).toBe(queued.length)
    expect(findPendingIdentifierReconciliations).toHaveBeenCalledTimes(4)
  })

  test('caps the number of accounts attempted in one tick', async () => {
    queueUsers(200)
    await service.reconcile()
    expect(withIdentifierReconciliation).toHaveBeenCalledTimes(128)
    expect(findPendingIdentifierReconciliations).toHaveBeenCalledTimes(8)
  })

  test('moves past accounts locked by another worker without repeatedly selecting them', async () => {
    const queued = queueUsers(40)
    asMockedFunction(withIdentifierReconciliation).mockImplementation(async (userId, _, run) => {
      if (userId >= 116)
        await run(
          queued.find(item => item.userId === userId)!,
          CLIENT,
        )
    })
    await service.reconcile()
    expect(withIdentifierReconciliation).toHaveBeenCalledTimes(40)
    expect(handleNewIdentifiers).toHaveBeenCalledTimes(24)
  })

  test('stops starting work when the monotonic time budget expires', async () => {
    queueUsers(40)
    handleNewIdentifiers.mockImplementationOnce(async () => {
      monotonicNow.mockReturnValue(5_000)
    })
    await service.reconcile()
    expect(withIdentifierReconciliation).toHaveBeenCalledOnce()
    expect(finishIdentifierReconciliation).toHaveBeenCalledOnce()
  })

  test('reconciles restrictions even for IDs committed by an earlier attempt', async () => {
    await service.reconcile()
    expect(handleNewIdentifiers).toHaveBeenCalledWith(USER, IDS)
    expect(finishIdentifierReconciliation).toHaveBeenCalledWith(work, CLIENT)
    expect(scheduleIdentifierBan).not.toHaveBeenCalled()
  })

  test('a restriction failure leaves the revision pending and retries later', async () => {
    handleNewIdentifiers.mockRejectedValueOnce(new Error('Interrupted'))
    await service.reconcile()
    expect(retryIdentifierReconciliation).toHaveBeenCalledWith(work, CLIENT)
    expect(finishIdentifierReconciliation).not.toHaveBeenCalled()
    await service.reconcile()
    expect(handleNewIdentifiers).toHaveBeenCalledTimes(2)
    expect(finishIdentifierReconciliation).toHaveBeenCalledOnce()
  })

  test('a clean observation does not prevent a later observation scheduling a ban', async () => {
    await service.reconcile()
    asMockedFunction(countBannedUserIdentifiers).mockResolvedValue([4, new Date(NOW + 86_400_000)])
    work.revision = '3'
    await service.reconcile()
    expect(scheduleIdentifierBan).toHaveBeenCalledWith(work, new Date(NOW + 172_800_000), CLIENT)
    expect(enactIdentifierBanRequest).not.toHaveBeenCalled()
  })

  test('later periodic samples cannot extend or reschedule an existing hold', async () => {
    work.actionState = 'pending'
    work.notBefore = new Date(NOW + 3_600_000)
    work.endTime = new Date(NOW + 86_400_000)
    await service.reconcile()
    expect(handleNewIdentifiers).toHaveBeenCalledOnce()
    expect(scheduleIdentifierBan).not.toHaveBeenCalled()
    expect(enactIdentifierBanRequest).not.toHaveBeenCalled()
  })

  test('due actions retain their request identity and frozen expiry', async () => {
    work.actionState = 'pending'
    work.processedRevision = work.revision
    work.notBefore = new Date(NOW - 1)
    work.endTime = new Date(NOW + 86_400_000)
    enactIdentifierBanRequest.mockRejectedValueOnce(new Error('Interrupted cleanup'))
    await service.reconcile()
    expect(finishIdentifierBan).not.toHaveBeenCalled()
    await service.reconcile()
    expect(enactIdentifierBanRequest).toHaveBeenNthCalledWith(1, {
      requestId: work.requestId,
      targetId: USER,
      endTime: work.endTime,
      reason: 'ban evasion',
    })
    expect(enactIdentifierBanRequest).toHaveBeenNthCalledWith(2, {
      requestId: work.requestId,
      targetId: USER,
      endTime: work.endTime,
      reason: 'ban evasion',
    })
    expect(finishIdentifierBan).toHaveBeenCalledWith(work, 'done', CLIENT)
  })

  test('manual unban or expired identifier bans can cancel a pending action', async () => {
    work.actionState = 'pending'
    work.notBefore = new Date(NOW - 1)
    work.endTime = new Date(NOW + 86_400_000)
    enactIdentifierBanRequest.mockResolvedValue({ status: 'notNeeded' })
    await service.reconcile()
    expect(finishIdentifierBan).toHaveBeenCalledWith(work, 'idle', CLIENT)
  })

  test('notification failure retries the same ban receipt and includes no identifiers', async () => {
    work.actionState = 'pending'
    work.processedRevision = work.revision
    work.notBefore = new Date(NOW - 1)
    work.endTime = new Date(NOW + 86_400_000)
    notify.mockRejectedValueOnce(new Error('Discord unavailable'))
    await service.reconcile()
    expect(finishIdentifierBan).not.toHaveBeenCalled()
    await service.reconcile()
    expect(enactIdentifierBanRequest).toHaveBeenCalledTimes(2)
    expect(notify).toHaveBeenCalledWith({ content: expect.stringContaining('/games/game') })
    expect(notify).toHaveBeenCalledWith({
      content: expect.stringContaining('/users/7/Test%20user/'),
    })
    expect(notify.mock.calls[0][0].content).not.toContain(IDS[0][1].toString('hex'))
    expect(finishIdentifierBan).toHaveBeenCalledWith(work, 'done', CLIENT)
  })

  test('completed actions still reconcile fresh restrictions without banning again', async () => {
    work.actionState = 'done'
    mirrorActiveBanIdentifiers.mockResolvedValue(true)
    await service.reconcile()
    expect(handleNewIdentifiers).toHaveBeenCalledOnce()
    expect(mirrorActiveBanIdentifiers).toHaveBeenCalledWith(USER)
    expect(countBannedUserIdentifiers).not.toHaveBeenCalled()
    expect(enactIdentifierBanRequest).not.toHaveBeenCalled()
  })

  test('a currently banned account is not scheduled for an extension', async () => {
    mirrorActiveBanIdentifiers.mockResolvedValue(true)
    await service.reconcile()
    expect(finishIdentifierBan).toHaveBeenCalledWith(work, 'done', CLIENT)
    expect(scheduleIdentifierBan).not.toHaveBeenCalled()
  })

  test('failed ban propagation keeps the observation pending for retry', async () => {
    mirrorActiveBanIdentifiers.mockRejectedValueOnce(new Error('Database interrupted'))
    await service.reconcile()
    expect(finishIdentifierReconciliation).not.toHaveBeenCalled()
    expect(retryIdentifierReconciliation).toHaveBeenCalledWith(work, CLIENT)
    await service.reconcile()
    expect(mirrorActiveBanIdentifiers).toHaveBeenCalledTimes(2)
    expect(finishIdentifierReconciliation).toHaveBeenCalledOnce()
  })
})
