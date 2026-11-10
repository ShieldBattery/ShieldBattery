import { RouterContext } from '@koa/router'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { makeMapFamilyId, makeSbMapId } from '../../../common/maps'
import { getGameListSideData } from '../games/game-list-data'
import { getGames } from '../games/game-models'
import { MapsApi } from './map-api'
import { resolveMapPageId } from './map-models'

vi.mock('./map-models', async importOriginal => ({
  ...(await importOriginal<typeof import('./map-models')>()),
  resolveMapPageId: vi.fn(),
}))
vi.mock('../games/game-models', async importOriginal => ({
  ...(await importOriginal<typeof import('../games/game-models')>()),
  getGames: vi.fn(),
}))
vi.mock('../games/game-list-data', async importOriginal => ({
  ...(await importOriginal<typeof import('../games/game-list-data')>()),
  getGameListSideData: vi.fn(),
}))

const FAMILY_ID = makeMapFamilyId('5eed0000-0000-0000-0000-00000000ffff')
const FILE_ID = makeSbMapId('5eed0000-0000-0000-0000-00000000aaaa')
const CURRENT_ID = makeSbMapId('5eed0000-0000-0000-0000-00000000bbbb')

function makeGamesCtx(mapId: string): RouterContext {
  return { params: { mapId }, request: { query: {} }, log: {} } as any
}

describe('maps/map-api/MapsApi#getMapGames', () => {
  const api = new MapsApi({} as any)

  beforeEach(() => {
    vi.mocked(getGames).mockReset().mockResolvedValue([])
    vi.mocked(getGameListSideData)
      .mockReset()
      .mockResolvedValue({ users: [], maps: [], replays: [] } as any)
    vi.mocked(resolveMapPageId).mockReset()
  })

  test("lists the games of every file of a map when given the map's id", async () => {
    vi.mocked(resolveMapPageId).mockResolvedValue({
      familyId: FAMILY_ID,
      currentMapId: CURRENT_ID,
      listed: true,
    })

    await api.getMapGames(makeGamesCtx(FAMILY_ID))

    expect(getGames).toHaveBeenCalledTimes(1)
    const params = vi.mocked(getGames).mock.calls[0][0]
    expect(params.mapFamilyId).toBe(FAMILY_ID)
    expect(params.mapId).toBeUndefined()
  })

  test("lists the games of one file when given a file's id", async () => {
    vi.mocked(resolveMapPageId).mockResolvedValue({
      familyId: FAMILY_ID,
      currentMapId: CURRENT_ID,
      listed: true,
      fileId: FILE_ID,
    })

    await api.getMapGames(makeGamesCtx(FILE_ID))

    const params = vi.mocked(getGames).mock.calls[0][0]
    expect(params.mapId).toBe(FILE_ID)
    expect(params.mapFamilyId).toBeUndefined()
  })

  test('falls back to the requested id when it names nothing', async () => {
    vi.mocked(resolveMapPageId).mockResolvedValue(undefined)

    await api.getMapGames(makeGamesCtx(FILE_ID))

    const params = vi.mocked(getGames).mock.calls[0][0]
    expect(params.mapId).toBe(FILE_ID)
    expect(params.mapFamilyId).toBeUndefined()
  })
})
