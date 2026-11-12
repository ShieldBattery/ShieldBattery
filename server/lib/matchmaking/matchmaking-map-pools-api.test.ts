import { RouterContext } from '@koa/router'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { makeSbMapId } from '../../../common/maps'
import { MatchmakingType } from '../../../common/matchmaking'
import { getMapInfos, resolveMapIdSets } from '../maps/map-models'
import { CurrentMapPoolCache } from './current-map-pool-cache'
import { MatchmakingMapPoolsApi } from './matchmaking-map-pools-api'
import {
  addMapPool,
  getMapPoolById,
  MapPoolMapsError,
  removeMapPool,
} from './matchmaking-map-pools-models'

vi.mock('./matchmaking-map-pools-models', async importOriginal => ({
  ...(await importOriginal<typeof import('./matchmaking-map-pools-models')>()),
  addMapPool: vi.fn(),
  getMapPoolById: vi.fn(),
  getMapPoolHistory: vi.fn(),
  removeMapPool: vi.fn(),
}))
vi.mock('../maps/map-models', () => ({
  getMapInfos: vi.fn(),
  resolveMapIdSets: vi.fn(),
}))

const MAP_A = makeSbMapId('a1000000-0000-0000-0000-000000000001')
const MAP_B = makeSbMapId('b1000000-0000-0000-0000-000000000001')

function makeCreateCtx(body: unknown): RouterContext {
  return {
    params: { matchmakingType: MatchmakingType.Match1v1 },
    request: { body, query: {} },
  } as any
}

function makeDeleteCtx(mapPoolId: number): RouterContext {
  return { params: { mapPoolId: String(mapPoolId) }, request: { query: {} } } as any
}

describe('server/matchmaking/matchmaking-map-pools-api', () => {
  let cache: { invalidate: ReturnType<typeof vi.fn> }
  let api: MatchmakingMapPoolsApi

  beforeEach(() => {
    vi.resetAllMocks()
    cache = { invalidate: vi.fn() }
    api = new MatchmakingMapPoolsApi(cache as unknown as CurrentMapPoolCache)
    vi.mocked(resolveMapIdSets).mockImplementation(async lists => lists.map(l => [...l]))
    vi.mocked(getMapInfos).mockResolvedValue([])
  })

  test('creates a pool from the resolved map ids and drops the cached current pool', async () => {
    const startDate = Date.now() + 60_000
    vi.mocked(addMapPool).mockResolvedValue({
      id: 7,
      matchmakingType: MatchmakingType.Match1v1,
      maps: [MAP_B, MAP_A],
      maxVetoCount: 2,
      startDate: new Date(startDate),
    })

    const response = await api.createNewMapPool(
      makeCreateCtx({ maps: [MAP_B, MAP_A], maxVetoCount: 2, startDate }),
    )

    expect(addMapPool).toHaveBeenCalledWith({
      matchmakingType: MatchmakingType.Match1v1,
      maps: [MAP_B, MAP_A],
      maxVetoCount: 2,
      startDate: new Date(startDate),
    })
    expect(response.pool).toEqual({
      id: 7,
      matchmakingType: MatchmakingType.Match1v1,
      maps: [MAP_B, MAP_A],
      maxVetoCount: 2,
      startDate,
    })
    expect(cache.invalidate).toHaveBeenCalledWith(MatchmakingType.Match1v1)
  })

  test("refuses maps that don't exist or aren't published with a 400 naming them", async () => {
    vi.mocked(addMapPool).mockRejectedValue(new MapPoolMapsError([MAP_B]))

    await expect(
      api.createNewMapPool(
        makeCreateCtx({ maps: [MAP_A, MAP_B], maxVetoCount: 2, startDate: Date.now() + 60_000 }),
      ),
    ).rejects.toMatchObject({ status: 400, message: expect.stringContaining(MAP_B) })
    expect(cache.invalidate).not.toHaveBeenCalled()
  })

  test('refuses an empty map list', async () => {
    await expect(
      api.createNewMapPool(
        makeCreateCtx({ maps: [], maxVetoCount: 2, startDate: Date.now() + 60_000 }),
      ),
    ).rejects.toMatchObject({ status: 400 })
    expect(addMapPool).not.toHaveBeenCalled()
  })

  test('passes on unexpected failures', async () => {
    vi.mocked(addMapPool).mockRejectedValue(new Error('connection lost'))

    await expect(
      api.createNewMapPool(
        makeCreateCtx({ maps: [MAP_A], maxVetoCount: 2, startDate: Date.now() + 60_000 }),
      ),
    ).rejects.toThrow('connection lost')
  })

  test('deletes a pool that has not started', async () => {
    vi.mocked(getMapPoolById).mockResolvedValue({
      id: 7,
      matchmakingType: MatchmakingType.Match2v2,
      maps: [MAP_A],
      maxVetoCount: 2,
      startDate: new Date(Date.now() + 60_000),
    })
    const ctx = makeDeleteCtx(7)

    await api.removeMapPool(ctx)

    expect(removeMapPool).toHaveBeenCalledWith(7)
    expect(cache.invalidate).toHaveBeenCalledWith(MatchmakingType.Match2v2)
    expect(ctx.status).toBe(204)
  })

  test('refuses to delete a pool that has started', async () => {
    vi.mocked(getMapPoolById).mockResolvedValue({
      id: 7,
      matchmakingType: MatchmakingType.Match1v1,
      maps: [MAP_A],
      maxVetoCount: 2,
      startDate: new Date(Date.now() - 60_000),
    })

    await expect(api.removeMapPool(makeDeleteCtx(7))).rejects.toMatchObject({ status: 400 })
    expect(removeMapPool).not.toHaveBeenCalled()
  })
})

describe('server/matchmaking/matchmaking-map-pools-models/MapPoolMapsError', () => {
  test('names the maps it refused', () => {
    const error = new MapPoolMapsError([MAP_A, MAP_B])
    expect(error.mapIds).toEqual([MAP_A, MAP_B])
    expect(error.message).toContain(MAP_A)
    expect(error.message).toContain(MAP_B)
  })
})
