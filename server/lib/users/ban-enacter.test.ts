import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { asMockedFunction } from '../../../common/testing/mocks'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import transact from '../db/transaction'
import { getGameRecord, lockGameAndCheckReconciled } from '../games/game-models'
import { recordReplayViolation } from '../models/game-replay-violations'
import { getUserGameRecord } from '../models/games-users'
import { Redis } from '../redis/redis'
import { DeletedSessionRegistry } from '../session/deleted-sessions'
import { UserSocketsManager } from '../websockets/socket-groups'
import { BanEnacter } from './ban-enacter'
import { banUsers, getActiveUserBan, lockActiveBanUsers } from './ban-models'
import {
  BanRequestConflict,
  BanRequestReceipt,
  completeBanRequest,
  lockBanRequest,
  recordBanRequestBans,
} from './ban-request-models'
import {
  banAllIdentifiers,
  countBannedUserIdentifiers,
  findConnectedUsers,
} from './user-identifiers'
import { findUserById } from './user-model'

vi.mock('./ban-models', () => ({
  banUsers: vi.fn(),
  getActiveUserBan: vi.fn(),
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
  countBannedUserIdentifiers: vi.fn(),
  findConnectedUsers: vi.fn(),
  liftIdentifierBans: vi.fn(),
}))
vi.mock('./user-model', () => ({ findUserById: vi.fn() }))
vi.mock('./client-ids', () => ({ MIN_IDENTIFIER_MATCHES: 4 }))
vi.mock('../games/game-models', () => ({
  getGameRecord: vi.fn(),
  lockGameAndCheckReconciled: vi.fn(),
}))
vi.mock('../models/game-replay-violations', () => ({ recordReplayViolation: vi.fn() }))
vi.mock('../models/games-users', () => ({ getUserGameRecord: vi.fn() }))
const dbClient = { query: vi.fn().mockResolvedValue({ rows: [] }) }
vi.mock('../db/transaction', () => ({
  default: vi.fn(async next => next(dbClient)),
}))

const TARGET = makeSbUserId(7)
const CONNECTED = makeSbUserId(8)
const GAME_ID = '11111111-2222-4333-8444-555555555555'
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
    asMockedFunction(getActiveUserBan).mockResolvedValue(undefined)
    asMockedFunction(countBannedUserIdentifiers).mockResolvedValue([4, new Date(REQUEST.endTime)])
    asMockedFunction(getUserGameRecord).mockResolvedValue({
      userId: TARGET,
      gameId: GAME_ID,
    } as any)
    asMockedFunction(getGameRecord).mockResolvedValue(undefined)
    asMockedFunction(recordReplayViolation).mockResolvedValue(undefined)
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

  test('protects the associated game for only the target before applying bans', async () => {
    const order: string[] = []
    asMockedFunction(lockGameAndCheckReconciled).mockImplementationOnce(async () => {
      order.push('lock')
      return false
    })
    asMockedFunction(getUserGameRecord).mockImplementationOnce(async () => {
      order.push('membership')
      return { userId: TARGET, gameId: GAME_ID } as any
    })
    asMockedFunction(recordReplayViolation).mockImplementationOnce(async () => {
      order.push('protect')
    })
    asMockedFunction(banUsers).mockImplementationOnce(async () => {
      order.push('ban')
      return [{ id: 'target-ban', userId: TARGET }] as any
    })
    await service.enactBanRequest({ ...REQUEST, gameId: GAME_ID })
    expect(order).toEqual(['lock', 'membership', 'protect', 'ban'])
    expect(lockGameAndCheckReconciled).toHaveBeenCalledExactlyOnceWith(dbClient, GAME_ID)
    expect(getUserGameRecord).toHaveBeenCalledExactlyOnceWith(TARGET, GAME_ID, dbClient)
    expect(recordReplayViolation).toHaveBeenCalledExactlyOnceWith(dbClient, {
      gameId: GAME_ID,
      userId: TARGET,
      details: { kind: 'clientMismatch' },
    })
    expect(getGameRecord).not.toHaveBeenCalled()
  })

  test('requests without a game do not change game protection', async () => {
    await service.enactBanRequest(REQUEST)
    expect(lockGameAndCheckReconciled).not.toHaveBeenCalled()
    expect(getUserGameRecord).not.toHaveBeenCalled()
    expect(recordReplayViolation).not.toHaveBeenCalled()
  })

  test('observers can be banned without changing player results or refunds', async () => {
    asMockedFunction(getUserGameRecord).mockResolvedValue(null)
    asMockedFunction(getGameRecord).mockResolvedValue({
      id: GAME_ID,
      config: { observers: [TARGET] },
    } as any)
    const request = { ...REQUEST, gameId: GAME_ID }
    expect(await service.enactBanRequest(request)).toBe('target-ban')
    expect(lockGameAndCheckReconciled).toHaveBeenCalledExactlyOnceWith(dbClient, GAME_ID)
    expect(getUserGameRecord).toHaveBeenCalledExactlyOnceWith(TARGET, GAME_ID, dbClient)
    expect(getGameRecord).toHaveBeenCalledExactlyOnceWith(GAME_ID, dbClient)
    expect(recordReplayViolation).not.toHaveBeenCalled()
    expect(banUsers).toHaveBeenCalledOnce()
    expect(banAllIdentifiers).toHaveBeenCalledOnce()
    expect(await service.enactBanRequest(request)).toBe('target-ban')
    expect(getGameRecord).toHaveBeenCalledOnce()
    expect(banUsers).toHaveBeenCalledOnce()
  })

  test.each([undefined, {}, { observers: [] }, { observers: [CONNECTED] }])(
    'non-members and missing games fail before bans or protection (%j)',
    async config => {
      asMockedFunction(getUserGameRecord).mockResolvedValueOnce(null)
      asMockedFunction(getGameRecord).mockResolvedValueOnce(
        config ? ({ id: GAME_ID, config } as any) : undefined,
      )
      await expect(service.enactBanRequest({ ...REQUEST, gameId: GAME_ID })).rejects.toMatchObject({
        status: 400,
      })
      expect(recordReplayViolation).not.toHaveBeenCalled()
      expect(findConnectedUsers).not.toHaveBeenCalled()
      expect(banUsers).not.toHaveBeenCalled()
      expect(recordBanRequestBans).not.toHaveBeenCalled()
      expect(sMembers).not.toHaveBeenCalled()
      expect(getGameRecord).toHaveBeenCalledExactlyOnceWith(GAME_ID, dbClient)
    },
  )

  test('a protection failure aborts the transaction before enforcement or cleanup', async () => {
    asMockedFunction(recordReplayViolation).mockRejectedValueOnce(new Error('Write failed'))
    await expect(service.enactBanRequest({ ...REQUEST, gameId: GAME_ID })).rejects.toThrow(
      'Write failed',
    )
    expect(transact).toHaveBeenCalledOnce()
    expect(banUsers).not.toHaveBeenCalled()
    expect(banAllIdentifiers).not.toHaveBeenCalled()
    expect(recordBanRequestBans).not.toHaveBeenCalled()
    expect(completeBanRequest).not.toHaveBeenCalled()
    expect(sMembers).not.toHaveBeenCalled()
  })

  test('a ban failure rejects the protection transaction without completing the request', async () => {
    asMockedFunction(banUsers).mockRejectedValueOnce(new Error('Ban failed'))
    await expect(service.enactBanRequest({ ...REQUEST, gameId: GAME_ID })).rejects.toThrow(
      'Ban failed',
    )
    expect(recordReplayViolation).toHaveBeenCalledOnce()
    expect(transact).toHaveBeenCalledOnce()
    expect(recordBanRequestBans).not.toHaveBeenCalled()
    expect(completeBanRequest).not.toHaveBeenCalled()
    expect(sMembers).not.toHaveBeenCalled()
  })

  test('cleanup retries do not repeat protection, including after an administrative unban', async () => {
    const request = { ...REQUEST, gameId: GAME_ID }
    execAsPipeline.mockRejectedValueOnce(new Error('Redis unavailable'))
    await expect(service.enactBanRequest(request)).rejects.toThrow('Redis unavailable')
    asMockedFunction(lockActiveBanUsers).mockResolvedValue([])
    expect(await service.enactBanRequest(request)).toBe('target-ban')
    expect(recordReplayViolation).toHaveBeenCalledOnce()
    expect(getUserGameRecord).toHaveBeenCalledOnce()
    expect(banUsers).toHaveBeenCalledOnce()
    vi.clearAllMocks()
    expect(await service.enactBanRequest(request)).toBe('target-ban')
    expect(recordReplayViolation).not.toHaveBeenCalled()
    expect(banUsers).not.toHaveBeenCalled()
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

  test('identifier requests check live matches before applying a ban', async () => {
    asMockedFunction(countBannedUserIdentifiers).mockResolvedValue([3, REQUEST.endTime])
    expect(await service.enactIdentifierBanRequest(REQUEST)).toEqual({ status: 'notNeeded' })
    expect(banUsers).not.toHaveBeenCalled()
    expect(recordBanRequestBans).not.toHaveBeenCalled()
  })

  test('identifier requests use the configured matching threshold', async () => {
    expect(await service.enactIdentifierBanRequest(REQUEST)).toEqual({
      status: 'banned',
      banId: 'target-ban',
    })
    expect(countBannedUserIdentifiers).toHaveBeenCalledWith(TARGET, dbClient)
    expect(recordReplayViolation).not.toHaveBeenCalled()
  })

  test('an already banned target gets a terminal receipt without extending its ban', async () => {
    asMockedFunction(getActiveUserBan).mockResolvedValue({ id: 'old-ban' } as any)
    expect(await service.enactIdentifierBanRequest(REQUEST)).toEqual({ status: 'alreadyBanned' })
    expect(banUsers).not.toHaveBeenCalled()
    expect(receipt.banId).toBe('old-ban')
    expect(receipt.completedAt).not.toBeNull()
    asMockedFunction(getActiveUserBan).mockResolvedValue(undefined)
    expect(await service.enactIdentifierBanRequest(REQUEST)).toEqual({
      status: 'banned',
      banId: 'old-ban',
    })
    expect(banUsers).not.toHaveBeenCalled()
    expect(closeAll).not.toHaveBeenCalled()
  })

  test('a committed identifier ban retries cleanup without rechecking or extending the ban', async () => {
    execAsPipeline.mockRejectedValueOnce(new Error('Redis unavailable'))
    await expect(service.enactIdentifierBanRequest(REQUEST)).rejects.toThrow('Redis unavailable')
    asMockedFunction(countBannedUserIdentifiers).mockResolvedValue([0, undefined])
    asMockedFunction(lockActiveBanUsers).mockResolvedValue([])
    expect(await service.enactIdentifierBanRequest(REQUEST)).toEqual({
      status: 'banned',
      banId: 'target-ban',
    })
    expect(banUsers).toHaveBeenCalledOnce()
    expect(countBannedUserIdentifiers).toHaveBeenCalledOnce()
  })

  test('late identifiers inherit the active ban dates without banning the account again', async () => {
    const startTime = new Date('2026-10-24T00:00:00Z')
    asMockedFunction(getActiveUserBan).mockResolvedValue({
      id: 'old-ban',
      userId: TARGET,
      startTime,
      endTime: REQUEST.endTime,
    })
    expect(await service.mirrorActiveBanIdentifiers(TARGET)).toBe(true)
    expect(banAllIdentifiers).toHaveBeenCalledWith(
      {
        users: [TARGET],
        timeBanned: startTime,
        bannedUntil: REQUEST.endTime,
      },
      dbClient,
    )
    expect(banUsers).not.toHaveBeenCalled()
    expect(closeAll).not.toHaveBeenCalled()
  })

  test('late identifiers do not restore an expired or administratively lifted ban', async () => {
    asMockedFunction(getActiveUserBan).mockResolvedValue(undefined)
    expect(await service.mirrorActiveBanIdentifiers(TARGET)).toBe(false)
    expect(banAllIdentifiers).not.toHaveBeenCalled()
    expect(banUsers).not.toHaveBeenCalled()
  })
})
