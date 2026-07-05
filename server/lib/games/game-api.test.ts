import { RouterContext } from '@koa/router'
import { describe, expect, test, vi } from 'vitest'
import { GameResultErrorCode } from '../../../common/games/results'
import { GameApi } from './game-api'
import { GameResultServiceError } from './game-result-service'

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
