import { RouterContext } from '@koa/router'
import { describe, expect, test, vi } from 'vitest'
import { GameResultErrorCode } from '../../../common/games/results'
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

/** Builds a minimal fake `RouterContext` that satisfies `results2`'s param/body Joi validation. */
function makeResultsCtx(): RouterContext {
  return {
    params: { gameId: 'game-1' },
    request: {
      body: {
        userId: 1,
        resultCode: 'abc123abc123',
        time: 1000,
        playerResults: [],
      },
    },
  } as any
}

/** Builds a `GameApi` with only the dependencies `submitGameResults` actually touches mocked. */
function makeApi({
  config,
  isLoading = false,
}: {
  config: Record<string, unknown>
  isLoading?: boolean
}) {
  const gameResultService = {
    retrieveGame: vi.fn().mockResolvedValue({ config }),
    submitGameResults: vi.fn().mockResolvedValue(undefined),
  }
  const gameLoader = { isLoading: vi.fn().mockReturnValue(isLoading) }
  const upsertUserIp = vi.fn().mockResolvedValue(undefined)
  const api = new GameApi(
    gameResultService as any,
    upsertUserIp as any,
    gameLoader as any,
    {} as any,
    {} as any,
    {} as any,
  )
  return { api, gameResultService }
}

describe('games/game-api/GameApi#submitGameResults', () => {
  test('rejects a results-exempt game with ResultsNotTracked, even if it also used netcode v2', async () => {
    const { api, gameResultService } = makeApi({
      config: { resultsExempt: true, useNetcodeV2: true },
    })

    const err = await api.submitGameResults(makeResultsCtx()).catch(e => e)

    expect(err).toBeInstanceOf(GameResultServiceError)
    expect((err as GameResultServiceError).code).toBe(GameResultErrorCode.ResultsNotTracked)
    expect(gameResultService.submitGameResults).not.toHaveBeenCalled()
  })

  test('rejects a non-exempt netcode-v2 game with RelayReportRequired', async () => {
    const { api, gameResultService } = makeApi({
      config: { useNetcodeV2: true },
    })

    const err = await api.submitGameResults(makeResultsCtx()).catch(e => e)

    expect(err).toBeInstanceOf(GameResultServiceError)
    expect((err as GameResultServiceError).code).toBe(GameResultErrorCode.RelayReportRequired)
    expect(gameResultService.submitGameResults).not.toHaveBeenCalled()
  })

  test('submits normally for a plain (non-exempt, non-v2) game', async () => {
    const { api, gameResultService } = makeApi({ config: {} })

    await api.submitGameResults(makeResultsCtx())

    expect(gameResultService.submitGameResults).toHaveBeenCalledTimes(1)
  })
})

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
    vi.fn() as any,
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
    expect(netcodeV2Service.rehomeSession).toHaveBeenCalledWith(42, 5)
    expect(returned).toEqual(decision)
  })
})
