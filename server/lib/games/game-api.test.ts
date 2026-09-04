import { RouterContext } from '@koa/router'
import { describe, expect, test, vi } from 'vitest'
import { GameStatus } from '../../../common/games/game-status'
import { GameResultErrorCode } from '../../../common/games/results'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { getUserGameRecord } from '../models/games-users'
import { GameApi } from './game-api'
import { getNetcodeV2Session } from './game-models'
import { GameResultServiceError } from './game-result-service'

vi.mock('../models/games-users', async importOriginal => ({
  ...(await importOriginal<typeof import('../models/games-users')>()),
  getUserGameRecord: vi.fn(),
}))
vi.mock('./game-models', async importOriginal => ({
  ...(await importOriginal<typeof import('./game-models')>()),
  getNetcodeV2Session: vi.fn(),
}))

/** A fake `RouterContext` satisfying `netcodeV2Rehome`'s param/body Joi validation. */
function makeRehomeCtx(): RouterContext {
  return {
    params: { gameId: 'game-1' },
    request: {
      body: { userId: 1, resultCode: 'abc123abc123', deadRelayId: 5 },
    },
  } as any
}

/** Builds a `GameApi` with only the dependencies `netcodeV2Rehome` touches mocked. */
function makeRehomeApi({
  isEnabled = true,
  isLoading = false,
}: {
  isEnabled?: boolean
  isLoading?: boolean
} = {}) {
  const gameLoader = { isLoading: vi.fn().mockReturnValue(isLoading) }
  const netcodeV2Service = {
    isEnabled: vi.fn().mockReturnValue(isEnabled),
    rehomeSession: vi.fn(),
  }
  const api = new GameApi(
    {} as any,
    gameLoader as any,
    {} as any,
    {} as any,
    netcodeV2Service as any,
  )
  return { api, netcodeV2Service }
}

describe('games/game-api/GameApi#netcodeV2Rehome', () => {
  test('rejects when netcode v2 is not enabled', async () => {
    const { api, netcodeV2Service } = makeRehomeApi({ isEnabled: false })

    const err = await api.netcodeV2Rehome(makeRehomeCtx()).catch(e => e)

    expect(err).toHaveProperty('status', 404)
    expect(netcodeV2Service.rehomeSession).not.toHaveBeenCalled()
  })

  test('rejects a request whose resultCode does not match the stored record', async () => {
    const { api, netcodeV2Service } = makeRehomeApi()
    vi.mocked(getUserGameRecord).mockResolvedValue({ resultCode: 'a-different-code' } as any)

    const err = await api.netcodeV2Rehome(makeRehomeCtx()).catch(e => e)

    expect(err).toBeInstanceOf(GameResultServiceError)
    expect((err as GameResultServiceError).code).toBe(GameResultErrorCode.NotFound)
    expect(netcodeV2Service.rehomeSession).not.toHaveBeenCalled()
  })

  test('rejects a participant who has already submitted a result', async () => {
    const { api, netcodeV2Service } = makeRehomeApi()
    // Valid resultCode, but this user is done: a reported result means they're no longer an active
    // participant, so they must not be able to drive failover (and drain the rehome rate limit).
    vi.mocked(getUserGameRecord).mockResolvedValue({
      resultCode: 'abc123abc123',
      reportedResults: { userId: 1 },
    } as any)

    const err = await api.netcodeV2Rehome(makeRehomeCtx()).catch(e => e)

    expect(err).toBeInstanceOf(GameResultServiceError)
    expect((err as GameResultServiceError).code).toBe(GameResultErrorCode.AlreadyReported)
    expect(netcodeV2Service.rehomeSession).not.toHaveBeenCalled()
  })

  test('rejects a participant whose mid-game departure was recorded', async () => {
    const { api, netcodeV2Service } = makeRehomeApi()
    vi.mocked(getUserGameRecord).mockResolvedValue({
      resultCode: 'abc123abc123',
      departureKind: 'left',
    } as any)

    const err = await api.netcodeV2Rehome(makeRehomeCtx()).catch(e => e)

    expect(err).toBeInstanceOf(GameResultServiceError)
    expect((err as GameResultServiceError).code).toBe(GameResultErrorCode.AlreadyReported)
    expect(netcodeV2Service.rehomeSession).not.toHaveBeenCalled()
  })

  test('rejects when the game has no netcode v2 session on record', async () => {
    const { api, netcodeV2Service } = makeRehomeApi()
    vi.mocked(getUserGameRecord).mockResolvedValue({ resultCode: 'abc123abc123' } as any)
    vi.mocked(getNetcodeV2Session).mockResolvedValue(null)

    const err = await api.netcodeV2Rehome(makeRehomeCtx()).catch(e => e)

    expect(err).toHaveProperty('status', 409)
    expect(netcodeV2Service.rehomeSession).not.toHaveBeenCalled()
  })

  test('re-homes with the stored session id and returns the coordinator decision', async () => {
    const { api, netcodeV2Service } = makeRehomeApi()
    vi.mocked(getUserGameRecord).mockResolvedValue({ resultCode: 'abc123abc123' } as any)
    vi.mocked(getNetcodeV2Session).mockResolvedValue(42)
    const decision = {
      decision: 'newTarget' as const,
      relay: { relayId: 9 } as any,
    }
    netcodeV2Service.rehomeSession.mockResolvedValue(decision)

    const ctx = makeRehomeCtx()
    // The route framework uses the handler's RETURN VALUE as the response body (http-api.ts
    // assigns `ctx.body = result`), so that's what must carry the decision — asserting on a
    // handler-set ctx.body would pass while production returned null.
    const returned = await api.netcodeV2Rehome(ctx)

    // The stored session id (not anything from the request) is what's re-homed, with the client's
    // reported dead relay id.
    expect(netcodeV2Service.rehomeSession).toHaveBeenCalledWith('game-1', 42, 5)
    expect(returned).toEqual(decision)
  })
})

/** A fake `RouterContext` satisfying `updateGameStatus`'s param/body Joi validation. */
function makeStatusCtx(status: GameStatus): RouterContext {
  return {
    params: { gameId: 'game-1' },
    request: { body: { status } },
    session: { user: { id: makeSbUserId(1) } },
  } as any
}

/** Builds a `GameApi` with only the loader queries `updateGameStatus` touches mocked. */
function makeStatusApi({
  isLoadingOrRecentlyLoaded = true,
  isLocalOnlyLoad = false,
}: {
  isLoadingOrRecentlyLoaded?: boolean
  isLocalOnlyLoad?: boolean
} = {}) {
  const gameLoader = {
    isLoadingOrRecentlyLoaded: vi.fn().mockReturnValue(isLoadingOrRecentlyLoaded),
    isLocalOnlyLoad: vi.fn().mockReturnValue(isLocalOnlyLoad),
    registerGameAsLoaded: vi.fn().mockReturnValue(true),
    maybeCancelLoading: vi.fn().mockReturnValue(true),
  }
  const api = new GameApi({} as any, gameLoader as any, {} as any, {} as any, {} as any)
  return { api, gameLoader }
}

describe('games/game-api/GameApi#updateGameStatus', () => {
  test('completes a local-only load from the client report', async () => {
    const { api, gameLoader } = makeStatusApi({ isLocalOnlyLoad: true })
    const ctx = makeStatusCtx(GameStatus.Playing)

    await api.updateGameStatus(ctx)

    expect(gameLoader.registerGameAsLoaded).toHaveBeenCalledWith('game-1', makeSbUserId(1))
    expect(ctx.status).toBe(204)
  })

  test('accepts but ignores a networked game client reporting itself as playing', async () => {
    const { api, gameLoader } = makeStatusApi({ isLocalOnlyLoad: false })
    const ctx = makeStatusCtx(GameStatus.Playing)

    // The coordinator owns this signal for a networked game, so the client's own report must
    // neither complete the load nor be answered as an error.
    await api.updateGameStatus(ctx)

    expect(gameLoader.registerGameAsLoaded).not.toHaveBeenCalled()
    expect(ctx.status).toBe(204)
  })

  test('cancels the load on a client-reported error regardless of transport', async () => {
    const { api, gameLoader } = makeStatusApi({ isLocalOnlyLoad: false })
    const ctx = makeStatusCtx(GameStatus.Error)

    await api.updateGameStatus(ctx)

    expect(gameLoader.maybeCancelLoading).toHaveBeenCalledWith('game-1', makeSbUserId(1))
    expect(ctx.status).toBe(204)
  })

  test('rejects a status report for a game that is neither loading nor recently loaded', async () => {
    const { api } = makeStatusApi({ isLoadingOrRecentlyLoaded: false })

    const err = await api.updateGameStatus(makeStatusCtx(GameStatus.Playing)).catch(e => e)

    expect(err).toHaveProperty('status', 409)
  })
})

/** A fake `RouterContext` for the flight-recordings endpoints, keyed to game-1. */
function makeFlightCtx(relayId?: number): RouterContext {
  return {
    params:
      relayId !== undefined ? { gameId: 'game-1', relayId: String(relayId) } : { gameId: 'game-1' },
  } as any
}

/** Builds a `GameApi` with only the dependencies the flight-recordings endpoints touch mocked. */
function makeFlightApi({ isEnabled = true }: { isEnabled?: boolean } = {}) {
  const netcodeV2Service = {
    isEnabled: vi.fn().mockReturnValue(isEnabled),
    listFlightBlobs: vi.fn(),
    fetchFlightBlob: vi.fn(),
  }
  const api = new GameApi({} as any, {} as any, {} as any, {} as any, netcodeV2Service as any)
  return { api, netcodeV2Service }
}

describe('games/game-api/GameApi#listFlightRecordings', () => {
  test('rejects when netcode v2 is not enabled', async () => {
    const { api, netcodeV2Service } = makeFlightApi({ isEnabled: false })

    const err = await api.listFlightRecordings(makeFlightCtx()).catch(e => e)

    expect(err).toHaveProperty('status', 404)
    expect(netcodeV2Service.listFlightBlobs).not.toHaveBeenCalled()
  })

  test('rejects when the game has no netcode v2 session on record', async () => {
    const { api, netcodeV2Service } = makeFlightApi()
    vi.mocked(getNetcodeV2Session).mockResolvedValue(null)

    const err = await api.listFlightRecordings(makeFlightCtx()).catch(e => e)

    expect(err).toHaveProperty('status', 404)
    expect(netcodeV2Service.listFlightBlobs).not.toHaveBeenCalled()
  })

  test('lists blobs for the session id stored on the game record', async () => {
    const { api, netcodeV2Service } = makeFlightApi()
    vi.mocked(getNetcodeV2Session).mockResolvedValue(42)
    const blob = { relayId: 7, pinned: false, size: 2048, lastModifiedMs: 1700000000000 }
    netcodeV2Service.listFlightBlobs.mockResolvedValue([blob])

    const returned = await api.listFlightRecordings(makeFlightCtx())

    // The stored session id (never anything client-supplied) is what's listed.
    expect(netcodeV2Service.listFlightBlobs).toHaveBeenCalledWith(42)
    expect(returned).toEqual({ blobs: [blob] })
  })
})

describe('games/game-api/GameApi#getFlightRecording', () => {
  test('rejects when netcode v2 is not enabled', async () => {
    const { api, netcodeV2Service } = makeFlightApi({ isEnabled: false })

    const err = await api.getFlightRecording(makeFlightCtx(7)).catch(e => e)

    expect(err).toHaveProperty('status', 404)
    expect(netcodeV2Service.fetchFlightBlob).not.toHaveBeenCalled()
  })

  test('rejects when the game has no netcode v2 session on record', async () => {
    const { api, netcodeV2Service } = makeFlightApi()
    vi.mocked(getNetcodeV2Session).mockResolvedValue(null)

    const err = await api.getFlightRecording(makeFlightCtx(7)).catch(e => e)

    expect(err).toHaveProperty('status', 404)
    expect(netcodeV2Service.fetchFlightBlob).not.toHaveBeenCalled()
  })

  test('returns 404 when the coordinator has no blob for that relay', async () => {
    const { api, netcodeV2Service } = makeFlightApi()
    vi.mocked(getNetcodeV2Session).mockResolvedValue(42)
    netcodeV2Service.fetchFlightBlob.mockResolvedValue(undefined)

    const err = await api.getFlightRecording(makeFlightCtx(7)).catch(e => e)

    expect(err).toHaveProperty('status', 404)
  })

  test('fetches the blob for the stored session id and the requested relay', async () => {
    const { api, netcodeV2Service } = makeFlightApi()
    vi.mocked(getNetcodeV2Session).mockResolvedValue(42)
    const recording = JSON.stringify({ events: ['connect'] })
    netcodeV2Service.fetchFlightBlob.mockResolvedValue(recording)
    const ctx = makeFlightCtx(7)

    const returned = await api.getFlightRecording(ctx)

    expect(netcodeV2Service.fetchFlightBlob).toHaveBeenCalledWith(42, 7)
    expect(returned).toBe(recording)
    expect(ctx.type).toBe('application/json')
  })
})
