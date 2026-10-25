import { beforeEach, describe, expect, test, vi } from 'vitest'
import createDeferred from '../../../common/async/deferred'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import transact from '../db/transaction'
import {
  deferReplayViolationRecovery,
  findPendingReplayViolationGames,
  recordReplayViolation,
  ReplayViolation,
} from '../models/game-replay-violations'
import { lockGameAndCheckReconciled } from './game-models'
import { ReplayViolationService } from './replay-violation-service'

vi.mock('../db/transaction', () => ({ default: vi.fn() }))
vi.mock('../models/game-replay-violations', () => ({
  deferReplayViolationRecovery: vi.fn(),
  findPendingReplayViolationGames: vi.fn(),
  recordReplayViolation: vi.fn(),
}))
vi.mock('./game-models', () => ({ lockGameAndCheckReconciled: vi.fn() }))

const violation: ReplayViolation = {
  gameId: 'game-1',
  userId: makeSbUserId(2),
  details: { kind: 'seedMismatch', expectedSeed: 1, actualSeed: 2 },
}

describe('ReplayViolationService', () => {
  const client = {} as any
  const refunds = { refundReplayViolation: vi.fn() }
  const scheduler = { scheduleImmediateJob: vi.fn() }
  let service: ReplayViolationService

  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(transact).mockImplementation(async callback => await callback(client))
    vi.mocked(lockGameAndCheckReconciled).mockResolvedValue(false)
    vi.mocked(findPendingReplayViolationGames).mockResolvedValue([])
    refunds.refundReplayViolation.mockResolvedValue(undefined)
    service = new ReplayViolationService(refunds as any, scheduler as any)
  })

  test.each([false, true])('records under the game lock when reconciled=%s', async reconciled => {
    const order: string[] = []
    vi.mocked(lockGameAndCheckReconciled).mockImplementation(async () => {
      order.push('lock')
      return reconciled
    })
    vi.mocked(recordReplayViolation).mockImplementation(async () => {
      order.push('record')
      return true
    })
    vi.mocked(transact).mockImplementation(async callback => {
      const result = await callback(client)
      order.push('commit')
      return result
    })
    refunds.refundReplayViolation.mockImplementation(async () => {
      order.push('refund')
    })
    await expect(service.recordViolation(violation)).resolves.toBe(true)
    expect(order).toEqual(['lock', 'record', 'commit', 'refund'])
    expect(recordReplayViolation).toHaveBeenCalledExactlyOnceWith(client, violation)
  })

  test('failed persistence prevents compensation of an unrecorded violation', async () => {
    vi.mocked(recordReplayViolation).mockRejectedValue(new Error('write failed'))
    await expect(service.recordViolation(violation)).rejects.toThrow('write failed')
    expect(refunds.refundReplayViolation).not.toHaveBeenCalled()
  })

  test('committed intent survives refund failures and is recovered on a later sweep', async () => {
    vi.mocked(recordReplayViolation).mockResolvedValue(true)
    refunds.refundReplayViolation.mockRejectedValueOnce(new Error('refund failed'))
    await expect(service.recordViolation(violation)).resolves.toBe(true)
    expect(deferReplayViolationRecovery).toHaveBeenCalledWith(violation.gameId)
    vi.mocked(findPendingReplayViolationGames).mockResolvedValue([violation.gameId])
    await service.recover()
    expect(refunds.refundReplayViolation).toHaveBeenCalledTimes(2)
    expect(recordReplayViolation).toHaveBeenCalledOnce()
  })

  test('schedules recovery and continues through individual failures', async () => {
    expect(scheduler.scheduleImmediateJob).toHaveBeenCalledWith(
      'games#replayViolationRefunds',
      30_000,
      expect.any(Function),
    )
    vi.mocked(findPendingReplayViolationGames).mockResolvedValue(['game-1', 'game-2'])
    refunds.refundReplayViolation.mockRejectedValueOnce(new Error('refund failed'))
    vi.mocked(deferReplayViolationRecovery).mockRejectedValueOnce(new Error('defer failed'))
    await service.recover()
    expect(findPendingReplayViolationGames).toHaveBeenCalledWith(100)
    expect(refunds.refundReplayViolation).toHaveBeenNthCalledWith(2, 'game-2')
  })

  test('overlapping sweeps join one bounded recovery pass', async () => {
    const gate = createDeferred<void>()
    const started = createDeferred<void>()
    vi.mocked(findPendingReplayViolationGames).mockResolvedValue([violation.gameId])
    refunds.refundReplayViolation.mockImplementation(async () => {
      started.resolve()
      await gate
    })
    const first = service.recover()
    await started
    const second = service.recover()
    expect(findPendingReplayViolationGames).toHaveBeenCalledOnce()
    gate.resolve()
    await Promise.all([first, second])
    expect(refunds.refundReplayViolation).toHaveBeenCalledOnce()
  })

  test('a failed candidate query does not block future sweeps', async () => {
    vi.mocked(findPendingReplayViolationGames).mockRejectedValueOnce(new Error('query failed'))
    await expect(service.recover()).rejects.toThrow('query failed')
    await expect(service.recover()).resolves.toBeUndefined()
    expect(findPendingReplayViolationGames).toHaveBeenCalledTimes(2)
  })
})
