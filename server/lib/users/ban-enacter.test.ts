import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { asMockedFunction } from '../../../common/testing/mocks'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { Redis } from '../redis/redis'
import { DeletedSessionRegistry } from '../session/deleted-sessions'
import { UserSocketsManager } from '../websockets/socket-groups'
import { BanEnacter } from './ban-enacter'
import { banUsers, lockActiveBanUsers } from './ban-models'
import {
  BanRequestConflict,
  BanRequestReceipt,
  completeBanRequest,
  lockBanRequest,
  recordBanRequestBans,
} from './ban-request-models'
import { banAllIdentifiers, findConnectedUsers } from './user-identifiers'
import { findUserById } from './user-model'

vi.mock('./ban-models', () => ({
  banUsers: vi.fn(),
  lockActiveBanUsers: vi.fn(),
  liftUserBans: vi.fn(),
}))
vi.mock('./ban-request-models', async importOriginal => ({
  ...(await importOriginal<typeof import('./ban-request-models')>()),
  completeBanRequest: vi.fn(),
  lockBanRequest: vi.fn(),
  recordBanRequestBans: vi.fn(),
}))
vi.mock('./user-identifiers', () => ({
  banAllIdentifiers: vi.fn(),
  findConnectedUsers: vi.fn(),
  liftIdentifierBans: vi.fn(),
}))
vi.mock('./user-model', () => ({ findUserById: vi.fn() }))
const dbClient = {}
vi.mock('../db/transaction', () => ({
  default: vi.fn(async next => next(dbClient)),
}))

const TARGET = makeSbUserId(7)
const CONNECTED = makeSbUserId(8)
const REQUEST = {
  requestId: 'request-id',
  targetId: TARGET,
  endTime: new Date('9001-01-01T00:00:00.000Z'),
  reason: 'Account policy violation',
}

describe('ban request cleanup', () => {
  let service: BanEnacter
  let receipt: BanRequestReceipt
  const sMembers = vi.fn()
  const execAsPipeline = vi.fn()
  const del = vi.fn()
  const closeAll = vi.fn()
  const withCommandOptions = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    receipt = { ...REQUEST, banId: null, banIds: null, completedAt: null }
    asMockedFunction(lockBanRequest).mockImplementation(async () => ({ ...receipt }))
    asMockedFunction(recordBanRequestBans).mockImplementation(async (_, banId, banIds) => {
      receipt.banId = banId
      receipt.banIds = banIds
    })
    asMockedFunction(completeBanRequest).mockImplementation(async () => {
      receipt.completedAt = new Date()
    })
    asMockedFunction(findUserById).mockResolvedValue({ id: TARGET } as any)
    asMockedFunction(findConnectedUsers).mockResolvedValue([CONNECTED])
    asMockedFunction(banUsers).mockResolvedValue([
      { id: 'target-ban', userId: TARGET } as any,
      { id: 'connected-ban', userId: CONNECTED } as any,
    ])
    asMockedFunction(lockActiveBanUsers).mockResolvedValue([TARGET, CONNECTED])
    sMembers.mockResolvedValue(['session'])
    execAsPipeline.mockResolvedValue([])
    const client = { sMembers, del: execAsPipeline, multi: () => ({ del, execAsPipeline }) }
    withCommandOptions.mockReturnValue(client)
    service = new BanEnacter(
      { client: { ...client, withCommandOptions } } as unknown as Redis,
      { getById: () => ({ closeAll }) } as unknown as UserSocketsManager,
      { register: vi.fn() } as unknown as DeletedSessionRegistry,
    )
  })
  afterEach(() => vi.restoreAllMocks())

  test('persists bans and identifiers before clearing sessions and completing the receipt', async () => {
    expect(await service.enactBanRequest(REQUEST)).toBe('target-ban')
    expect(banAllIdentifiers).toHaveBeenCalledWith(
      { users: [CONNECTED, TARGET], bannedUntil: REQUEST.endTime },
      dbClient,
    )
    expect(recordBanRequestBans).toHaveBeenCalledWith(
      REQUEST.requestId,
      'target-ban',
      ['target-ban', 'connected-ban'],
      dbClient,
    )
    expect(closeAll).toHaveBeenCalledTimes(2)
    expect(completeBanRequest).toHaveBeenCalledOnce()
  })

  test('retries failed cleanup without new bans or linked-account discovery', async () => {
    execAsPipeline.mockRejectedValueOnce(new Error('Redis unavailable'))
    await expect(service.enactBanRequest(REQUEST)).rejects.toThrow('Redis unavailable')
    expect(completeBanRequest).not.toHaveBeenCalled()
    expect(await service.enactBanRequest(REQUEST)).toBe('target-ban')
    expect(banUsers).toHaveBeenCalledOnce()
    expect(banAllIdentifiers).toHaveBeenCalledOnce()
    expect(findConnectedUsers).toHaveBeenCalledOnce()
    expect(execAsPipeline).toHaveBeenCalledTimes(2)
  })

  test('completed retries do not ban or disconnect users after an administrative unban', async () => {
    await service.enactBanRequest(REQUEST)
    vi.clearAllMocks()
    expect(await service.enactBanRequest(REQUEST)).toBe('target-ban')
    expect(banUsers).not.toHaveBeenCalled()
    expect(lockActiveBanUsers).not.toHaveBeenCalled()
    expect(sMembers).not.toHaveBeenCalled()
    expect(closeAll).not.toHaveBeenCalled()
  })

  test('an incomplete retry only cleans up original bans that remain active', async () => {
    receipt.banId = 'target-ban'
    receipt.banIds = ['target-ban', 'connected-ban']
    asMockedFunction(lockActiveBanUsers).mockResolvedValue([CONNECTED])
    await service.enactBanRequest(REQUEST)
    expect(lockActiveBanUsers).toHaveBeenCalledWith(receipt.banIds, dbClient)
    expect(sMembers).toHaveBeenCalledExactlyOnceWith(expect.stringContaining(String(CONNECTED)))
    expect(findConnectedUsers).not.toHaveBeenCalled()
  })

  test('an unbanned incomplete request finishes without disconnecting anyone', async () => {
    receipt.banId = 'target-ban'
    receipt.banIds = ['target-ban']
    asMockedFunction(lockActiveBanUsers).mockResolvedValue([])
    await service.enactBanRequest(REQUEST)
    expect(sMembers).not.toHaveBeenCalled()
    expect(completeBanRequest).toHaveBeenCalledOnce()
  })

  test('conflicting requests do not touch bans or sessions', async () => {
    asMockedFunction(lockBanRequest).mockRejectedValueOnce(new BanRequestConflict())
    await expect(service.enactBanRequest(REQUEST)).rejects.toBeInstanceOf(BanRequestConflict)
    expect(banUsers).not.toHaveBeenCalled()
    expect(sMembers).not.toHaveBeenCalled()
  })

  test('missing users do not create bans', async () => {
    asMockedFunction(findUserById).mockResolvedValue(undefined)
    await expect(service.enactBanRequest(REQUEST)).rejects.toMatchObject({ status: 404 })
    expect(banUsers).not.toHaveBeenCalled()
  })

  test('cancellation after Redis deletion cannot close sockets or complete the request', async () => {
    const controller = new AbortController()
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal)
    execAsPipeline.mockImplementationOnce(async () => {
      controller.abort(new Error('Cleanup deadline'))
      return []
    })
    await expect(service.enactBanRequest(REQUEST)).rejects.toThrow('Cleanup deadline')
    expect(withCommandOptions).toHaveBeenCalledWith({ abortSignal: controller.signal })
    expect(closeAll).not.toHaveBeenCalled()
    expect(completeBanRequest).not.toHaveBeenCalled()
  })

  test('ordinary bans retain their session cleanup and return the target ban', async () => {
    expect(await service.enactBan(REQUEST)).toMatchObject({ id: 'target-ban', userId: TARGET })
    expect(lockBanRequest).not.toHaveBeenCalled()
    expect(withCommandOptions).not.toHaveBeenCalled()
    expect(execAsPipeline).toHaveBeenCalledOnce()
    expect(closeAll).toHaveBeenCalledTimes(2)
  })
})
