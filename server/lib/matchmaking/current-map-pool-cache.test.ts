import { beforeEach, describe, expect, test, vi } from 'vitest'
import { MapInfo, SbMapId } from '../../../common/maps'
import { MatchmakingType } from '../../../common/matchmaking'
import { MatchmakingMapPool } from '../../../common/matchmaking/matchmaking-map-pools'
import { asMockedFunction } from '../../../common/testing/mocks'
import { getMapInfos } from '../maps/map-models'
import { reparseMapsAsNeeded } from '../maps/map-operations'
import { FakeClock } from '../time/testing/fake-clock'
import {
  CURRENT_MAP_POOL_TTL_MS,
  CurrentMapPoolCache,
  MAP_POOL_MAP_URL_EXPIRES_SEC,
} from './current-map-pool-cache'
import {
  getCurrentMapPool,
  getNextMapPoolStartDate,
  getPreviousMapPool,
} from './matchmaking-map-pools-models'

vi.mock('./matchmaking-map-pools-models', () => ({
  getCurrentMapPool: vi.fn(),
  getNextMapPoolStartDate: vi.fn(),
  getPreviousMapPool: vi.fn(),
}))
vi.mock('../maps/map-models', () => ({
  getMapInfos: vi.fn(),
}))
vi.mock('../maps/map-operations', () => ({
  reparseMapsAsNeeded: vi.fn(),
}))

const START_TIME = 1_000_000

function makePool(id: number): MatchmakingMapPool {
  return {
    id,
    matchmakingType: MatchmakingType.Match1v1,
    startDate: new Date(0),
    maps: [`map-${id}` as SbMapId],
    maxVetoCount: 3,
  }
}

/** Returns a promise along with the functions that settle it, to hold a load open. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (err: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('server/matchmaking/current-map-pool-cache', () => {
  let clock: FakeClock
  let cache: CurrentMapPoolCache

  beforeEach(() => {
    vi.resetAllMocks()
    clock = new FakeClock()
    clock.setCurrentTime(START_TIME)
    cache = new CurrentMapPoolCache(clock)

    asMockedFunction(getNextMapPoolStartDate).mockResolvedValue(undefined)
    asMockedFunction(getCurrentMapPool).mockResolvedValue(makePool(1))
    asMockedFunction(getPreviousMapPool).mockResolvedValue(null)
    asMockedFunction(getMapInfos).mockResolvedValue([])
    asMockedFunction(reparseMapsAsNeeded).mockImplementation(async maps => maps as MapInfo[])
  })

  test('concurrent requests share a single load', async () => {
    const pool = deferred<MatchmakingMapPool | null>()
    asMockedFunction(getCurrentMapPool).mockReturnValueOnce(pool.promise)

    const first = cache.get(MatchmakingType.Match1v1)
    const second = cache.get(MatchmakingType.Match1v1)
    await vi.waitFor(() => expect(getCurrentMapPool).toHaveBeenCalled())
    pool.resolve(makePool(1))

    expect((await first)?.pool.id).toBe(1)
    expect(await second).toBe(await first)
    expect(getCurrentMapPool).toHaveBeenCalledTimes(1)
  })

  test('serves the loaded pool until the TTL passes', async () => {
    await cache.get(MatchmakingType.Match1v1)

    clock.setCurrentTime(START_TIME + CURRENT_MAP_POOL_TTL_MS - 1)
    await cache.get(MatchmakingType.Match1v1)
    expect(getCurrentMapPool).toHaveBeenCalledTimes(1)

    asMockedFunction(getCurrentMapPool).mockResolvedValue(makePool(2))
    clock.setCurrentTime(START_TIME + CURRENT_MAP_POOL_TTL_MS)
    expect((await cache.get(MatchmakingType.Match1v1))?.pool.id).toBe(2)
    expect(getCurrentMapPool).toHaveBeenCalledTimes(2)
  })

  test('reloads once the next scheduled pool starts, even within the TTL', async () => {
    const nextStart = START_TIME + 5000
    asMockedFunction(getNextMapPoolStartDate).mockResolvedValue(new Date(nextStart))
    await cache.get(MatchmakingType.Match1v1)
    expect(getNextMapPoolStartDate).toHaveBeenCalledWith(
      MatchmakingType.Match1v1,
      new Date(START_TIME),
    )

    clock.setCurrentTime(nextStart - 1)
    await cache.get(MatchmakingType.Match1v1)
    expect(getCurrentMapPool).toHaveBeenCalledTimes(1)

    asMockedFunction(getCurrentMapPool).mockResolvedValue(makePool(2))
    clock.setCurrentTime(nextStart)
    expect((await cache.get(MatchmakingType.Match1v1))?.pool.id).toBe(2)
  })

  test('signs map download URLs for the map pool lifetime', async () => {
    await cache.get(MatchmakingType.Match1v1)

    expect(getMapInfos).toHaveBeenCalledWith(['map-1'], {
      mapUrlExpiresSec: MAP_POOL_MAP_URL_EXPIRES_SEC,
    })
  })

  test('includes how the pool differs from the previous one', async () => {
    const previous: MatchmakingMapPool = {
      ...makePool(0),
      startDate: new Date(-1000),
      maps: ['map-0' as SbMapId, 'map-1' as SbMapId],
      maxVetoCount: 2,
    }
    const current: MatchmakingMapPool = {
      ...makePool(1),
      startDate: new Date(500),
      maps: ['map-1' as SbMapId, 'map-2' as SbMapId, 'map-3' as SbMapId],
    }
    asMockedFunction(getCurrentMapPool).mockResolvedValue(current)
    asMockedFunction(getPreviousMapPool).mockResolvedValue(previous)

    const response = await cache.get(MatchmakingType.Match1v1)

    expect(getPreviousMapPool).toHaveBeenCalledWith(MatchmakingType.Match1v1, new Date(500))
    expect(response?.changes).toEqual({
      addedMaps: ['map-2', 'map-3'],
      removedMaps: ['map-0'],
      previousMapCount: 2,
      previousMaxVetoCount: 2,
    })
    expect(getMapInfos).toHaveBeenCalledWith(current.maps, expect.anything())
  })

  test('omits changes when there is no previous pool', async () => {
    const response = await cache.get(MatchmakingType.Match1v1)

    expect(response?.pool.id).toBe(1)
    expect(response?.changes).toBeUndefined()
  })

  test('caches a type having no current pool', async () => {
    asMockedFunction(getCurrentMapPool).mockResolvedValue(null)

    expect(await cache.get(MatchmakingType.Match1v1)).toBeUndefined()
    expect(await cache.get(MatchmakingType.Match1v1)).toBeUndefined()
    expect(getCurrentMapPool).toHaveBeenCalledTimes(1)
    expect(getMapInfos).not.toHaveBeenCalled()
  })

  test('keeps each matchmaking type separate', async () => {
    await cache.get(MatchmakingType.Match1v1)
    await cache.get(MatchmakingType.Match2v2)

    expect(getCurrentMapPool).toHaveBeenCalledTimes(2)
    expect(getCurrentMapPool).toHaveBeenCalledWith(MatchmakingType.Match1v1)
    expect(getCurrentMapPool).toHaveBeenCalledWith(MatchmakingType.Match2v2)
  })

  test('invalidating reloads on the next request', async () => {
    await cache.get(MatchmakingType.Match1v1)

    asMockedFunction(getCurrentMapPool).mockResolvedValue(makePool(2))
    cache.invalidate(MatchmakingType.Match1v1)
    expect((await cache.get(MatchmakingType.Match1v1))?.pool.id).toBe(2)
  })

  test('a load invalidated while running is not served afterward', async () => {
    const stalePool = deferred<MatchmakingMapPool | null>()
    asMockedFunction(getCurrentMapPool).mockReturnValueOnce(stalePool.promise)
    const stale = cache.get(MatchmakingType.Match1v1)
    await vi.waitFor(() => expect(getCurrentMapPool).toHaveBeenCalled())

    cache.invalidate(MatchmakingType.Match1v1)
    asMockedFunction(getCurrentMapPool).mockResolvedValue(makePool(2))
    const fresh = cache.get(MatchmakingType.Match1v1)
    stalePool.resolve(makePool(1))

    expect((await stale)?.pool.id).toBe(1)
    expect((await fresh)?.pool.id).toBe(2)
    expect((await cache.get(MatchmakingType.Match1v1))?.pool.id).toBe(2)
  })

  test('a failed load is not cached', async () => {
    asMockedFunction(getCurrentMapPool).mockRejectedValueOnce(new Error('db down'))

    await expect(cache.get(MatchmakingType.Match1v1)).rejects.toThrow('db down')
    expect((await cache.get(MatchmakingType.Match1v1))?.pool.id).toBe(1)
    expect(getCurrentMapPool).toHaveBeenCalledTimes(2)
  })
})
