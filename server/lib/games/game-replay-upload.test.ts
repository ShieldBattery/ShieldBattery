import { RouterContext } from '@koa/router'
import { Result } from 'typescript-result'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import createDeferred from '../../../common/async/deferred'
import { GameResultErrorCode } from '../../../common/games/results'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { ParsedReplay } from '../../workers/replays/messages'
import { parseReplay } from '../../workers/replays/replays'
import { getUserGameRecord } from '../models/games-users'
import { ReplayService } from '../replays/replay-service'
import { GameApi } from './game-api'
import { GameLifecycleEvents } from './game-lifecycle-events'

vi.mock('../../workers/replays/replays', () => ({ parseReplay: vi.fn() }))
vi.mock('../models/games-users', async importOriginal => ({
  ...(await importOriginal<typeof import('../models/games-users')>()),
  getUserGameRecord: vi.fn(),
}))

const USER_ID = makeSbUserId(1)
const GAME_ID = 'game-1'
const RESULT_CODE = 'abc123abc123'
const REPLAY_PATH = 'uploaded.rep'

function makeContext(): RouterContext {
  return {
    params: { gameId: GAME_ID },
    request: {
      body: { userId: USER_ID, resultCode: RESULT_CODE },
      files: { replay: { filepath: REPLAY_PATH } },
    },
    log: { warn: vi.fn() },
  } as any
}

function setReplaySeed(seed: unknown): ParsedReplay {
  const replay = { header: { startTime: seed } } as ParsedReplay
  vi.mocked(parseReplay).mockImplementation(() =>
    Result.fromAsyncCatching(async () => Result.ok(replay)),
  )
  return replay
}

function makeApi(seed: unknown = 123) {
  const gameResultService = {
    retrieveGame: vi.fn().mockResolvedValue({ config: { seed } }),
  }
  const gameLoader = { isLoading: vi.fn().mockReturnValue(false) }
  const banEnacter = { enactBan: vi.fn().mockResolvedValue(undefined) }
  const replayViolations = { recordViolation: vi.fn().mockResolvedValue(true) }
  const replayService = Object.assign(
    new ReplayService(banEnacter as any, replayViolations as any),
    {
      storeReplay: vi.fn().mockResolvedValue(undefined),
    },
  )
  const api = new GameApi(
    gameResultService as any,
    gameLoader as any,
    replayService as any,
    {} as any,
    {} as any,
    {} as any,
    new GameLifecycleEvents(),
    {} as any,
  )
  return { api, gameResultService, gameLoader, replayService, banEnacter, replayViolations }
}

describe('GameApi#submitGameReplay', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(getUserGameRecord).mockResolvedValue({ resultCode: RESULT_CODE } as any)
    setReplaySeed(123)
  })

  test.each([0, 123, 0x8000_0005, 0xffff_ffff])(
    'stores a replay with matching unsigned seed %i',
    async seed => {
      const replay = setReplaySeed(seed)
      const { api, gameResultService, replayService, banEnacter, replayViolations } = makeApi(seed)
      const ctx = makeContext()

      await api.submitGameReplay(ctx)

      expect(getUserGameRecord).toHaveBeenCalledWith(USER_ID, GAME_ID)
      expect(parseReplay).toHaveBeenCalledWith(REPLAY_PATH)
      expect(gameResultService.retrieveGame).toHaveBeenCalledWith(GAME_ID)
      expect(replayService.storeReplay).toHaveBeenCalledExactlyOnceWith(REPLAY_PATH, replay, {
        gameId: GAME_ID,
        userId: USER_ID,
      })
      expect(banEnacter.enactBan).not.toHaveBeenCalled()
      expect(replayViolations.recordViolation).not.toHaveBeenCalled()
      expect(ctx.status).toBe(204)
    },
  )

  test('persists protection before banning the uploader', async () => {
    setReplaySeed(124)
    const { api, replayViolations, banEnacter } = makeApi(123)
    const persisted = createDeferred<void>()
    const started = createDeferred<void>()
    replayViolations.recordViolation.mockImplementation(async () => {
      started.resolve()
      await persisted
      return true
    })
    const response = api.submitGameReplay(makeContext()).catch(error => error)
    await started
    expect(replayViolations.recordViolation).toHaveBeenCalledExactlyOnceWith({
      gameId: GAME_ID,
      userId: USER_ID,
      details: { kind: 'seedMismatch', expectedSeed: 123, actualSeed: 124 },
    })
    expect(banEnacter.enactBan).not.toHaveBeenCalled()
    persisted.resolve()
    await expect(response).resolves.toMatchObject({ code: GameResultErrorCode.ReplayRejected })
    expect(banEnacter.enactBan).toHaveBeenCalledOnce()
  })

  test('does not ban or store a replay when protection could not be persisted', async () => {
    setReplaySeed(124)
    const { api, replayViolations, banEnacter, replayService } = makeApi(123)
    replayViolations.recordViolation.mockRejectedValue(new Error('database unavailable'))
    await expect(api.submitGameReplay(makeContext())).rejects.toThrow('database unavailable')
    expect(banEnacter.enactBan).not.toHaveBeenCalled()
    expect(replayService.storeReplay).not.toHaveBeenCalled()
  })

  test('waits for the permanent ban before rejecting a seed mismatch', async () => {
    setReplaySeed(124)
    const { api, replayService, banEnacter } = makeApi(123)
    const banStarted = createDeferred<void>()
    const banFinished = createDeferred<void>()
    banEnacter.enactBan.mockImplementation(() => {
      banStarted.resolve()
      return banFinished
    })
    let settled = false
    const response = api.submitGameReplay(makeContext()).then(
      () => {
        settled = true
        return undefined
      },
      error => {
        settled = true
        return error
      },
    )

    await banStarted
    expect(settled).toBe(false)
    expect(banEnacter.enactBan).toHaveBeenCalledExactlyOnceWith({
      targetId: USER_ID,
      endTime: new Date('9001-01-01T00:00:00.000Z'),
      reason: 'Client integrity violation',
    })
    expect(replayService.storeReplay).not.toHaveBeenCalled()

    banFinished.resolve()
    await expect(response).resolves.toMatchObject({
      code: GameResultErrorCode.ReplayRejected,
      message: 'invalid replay',
    })
    expect(replayService.storeReplay).not.toHaveBeenCalled()
  })

  test('treats a stored zero seed as an expected seed', async () => {
    const { api, replayService, banEnacter } = makeApi(0)

    await expect(api.submitGameReplay(makeContext())).rejects.toMatchObject({
      code: GameResultErrorCode.ReplayRejected,
    })

    expect(banEnacter.enactBan).toHaveBeenCalledOnce()
    expect(replayService.storeReplay).not.toHaveBeenCalled()
  })

  test('bans only the upload that first records the mismatch', async () => {
    setReplaySeed(124)
    const { api, replayViolations, banEnacter, replayService } = makeApi(123)
    replayViolations.recordViolation.mockResolvedValue(false)

    await expect(api.submitGameReplay(makeContext())).rejects.toMatchObject({
      code: GameResultErrorCode.ReplayRejected,
    })

    expect(replayViolations.recordViolation).toHaveBeenCalledOnce()
    expect(banEnacter.enactBan).not.toHaveBeenCalled()
    expect(replayService.storeReplay).not.toHaveBeenCalled()
  })

  test('rejects a replay with no seed without banning the uploader', async () => {
    setReplaySeed(0)
    const { api, replayViolations, banEnacter, replayService } = makeApi(123)

    await expect(api.submitGameReplay(makeContext())).rejects.toMatchObject({
      code: GameResultErrorCode.ReplaySeedMissing,
    })

    expect(replayViolations.recordViolation).toHaveBeenCalledExactlyOnceWith({
      gameId: GAME_ID,
      userId: USER_ID,
      details: { kind: 'seedMissing', expectedSeed: 123 },
    })
    expect(banEnacter.enactBan).not.toHaveBeenCalled()
    expect(replayService.storeReplay).not.toHaveBeenCalled()
  })

  test('bans a mismatching upload even when a replay is already linked', async () => {
    vi.mocked(getUserGameRecord).mockResolvedValue({
      resultCode: RESULT_CODE,
      replayFileId: 'existing-replay',
    } as any)
    setReplaySeed(124)
    const { api, replayService, banEnacter } = makeApi()

    await expect(api.submitGameReplay(makeContext())).rejects.toMatchObject({
      code: GameResultErrorCode.ReplayRejected,
    })

    expect(parseReplay).toHaveBeenCalledOnce()
    expect(banEnacter.enactBan).toHaveBeenCalledOnce()
    expect(replayService.storeReplay).not.toHaveBeenCalled()
  })

  test('validates but does not store an already linked matching replay', async () => {
    vi.mocked(getUserGameRecord).mockResolvedValue({
      resultCode: RESULT_CODE,
      replayFileId: 'existing-replay',
    } as any)
    const { api, gameResultService, replayService, banEnacter } = makeApi()
    const ctx = makeContext()

    await api.submitGameReplay(ctx)

    expect(parseReplay).toHaveBeenCalledOnce()
    expect(gameResultService.retrieveGame).toHaveBeenCalledOnce()
    expect(banEnacter.enactBan).not.toHaveBeenCalled()
    expect(replayService.storeReplay).not.toHaveBeenCalled()
    expect(ctx.status).toBe(204)
  })

  test('stores a legacy game replay without a persisted seed', async () => {
    const { api, gameResultService, replayService, banEnacter } = makeApi()
    gameResultService.retrieveGame.mockResolvedValue({ config: {} } as any)
    const ctx = makeContext()

    await api.submitGameReplay(ctx)

    expect(replayService.storeReplay).toHaveBeenCalledOnce()
    expect(banEnacter.enactBan).not.toHaveBeenCalled()
    expect(ctx.status).toBe(204)
  })

  test.each([undefined, { resultCode: 'wrong-code' }])(
    'rejects unauthenticated uploads before parsing or checking the seed (%j)',
    async record => {
      vi.mocked(getUserGameRecord).mockResolvedValue(record as any)
      const { api, gameResultService, replayService, banEnacter } = makeApi()

      await expect(api.submitGameReplay(makeContext())).rejects.toMatchObject({
        code: GameResultErrorCode.NotFound,
      })

      expect(parseReplay).not.toHaveBeenCalled()
      expect(gameResultService.retrieveGame).not.toHaveBeenCalled()
      expect(banEnacter.enactBan).not.toHaveBeenCalled()
      expect(replayService.storeReplay).not.toHaveBeenCalled()
    },
  )

  test('rejects parse failures without fetching the game or banning', async () => {
    vi.mocked(parseReplay).mockImplementation(() =>
      Result.fromAsyncCatching(async () => Result.error(new Error('invalid compressed data'))),
    )
    const { api, gameResultService, replayService, banEnacter } = makeApi()

    await expect(api.submitGameReplay(makeContext())).rejects.toMatchObject({ status: 400 })

    expect(gameResultService.retrieveGame).not.toHaveBeenCalled()
    expect(banEnacter.enactBan).not.toHaveBeenCalled()
    expect(replayService.storeReplay).not.toHaveBeenCalled()
  })

  test.each([-1, 0x1_0000_0000, 1.5, NaN, Infinity, undefined, null, '123'])(
    'rejects an invalid parsed seed without banning (%j)',
    async seed => {
      setReplaySeed(seed)
      const { api, replayService, banEnacter } = makeApi()

      await expect(api.submitGameReplay(makeContext())).rejects.toMatchObject({ status: 400 })

      expect(banEnacter.enactBan).not.toHaveBeenCalled()
      expect(replayService.storeReplay).not.toHaveBeenCalled()
    },
  )

  test.each([-1, 0x1_0000_0000, 1.5, NaN, Infinity, null, '123'])(
    'does not blame the uploader for an invalid stored seed (%j)',
    async seed => {
      const { api, replayService, banEnacter } = makeApi(seed)

      await expect(api.submitGameReplay(makeContext())).rejects.toThrow('Invalid stored game seed')

      expect(banEnacter.enactBan).not.toHaveBeenCalled()
      expect(replayService.storeReplay).not.toHaveBeenCalled()
    },
  )

  test('propagates a failed ban without storing the replay', async () => {
    setReplaySeed(124)
    const { api, replayService, banEnacter } = makeApi()
    const failure = new Error('ban write failed')
    banEnacter.enactBan.mockRejectedValue(failure)

    await expect(api.submitGameReplay(makeContext())).rejects.toBe(failure)

    expect(banEnacter.enactBan).toHaveBeenCalledOnce()
    expect(replayService.storeReplay).not.toHaveBeenCalled()
  })
})
