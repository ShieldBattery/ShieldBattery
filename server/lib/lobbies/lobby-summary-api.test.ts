import { RouterContext } from '@koa/router'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { GameType } from '../../../common/games/game-type'
import { LobbySummaryJson } from '../../../common/lobbies/lobby-network'
import { makeSbLobbyId } from '../../../common/lobbies/sb-lobby-id'
import { makeSbMapId, MapInfoJson, MapVisibility, Tileset } from '../../../common/maps'
import { encodePrettyId } from '../../../common/pretty-id'
import { asMockedFunction } from '../../../common/testing/mocks'
import { SbUser } from '../../../common/users/sb-user'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { findUsersById } from '../users/user-model'
import { LobbySummaryGetter, setLobbySummaryGetter } from './lobby-summaries'
import { LobbySummaryApi } from './lobby-summary-api'

vi.mock('../users/user-model', async () => {
  const actual = await vi.importActual<typeof import('../users/user-model')>('../users/user-model')
  return { ...actual, findUsersById: vi.fn() }
})

const findUsersByIdMock = asMockedFunction(findUsersById)

const LOBBY_UUID = '5eed0000-0000-0000-0000-000000000042'
const LOBBY_PRETTY_ID = encodePrettyId(LOBBY_UUID)
const LOBBY_ID = makeSbLobbyId(LOBBY_PRETTY_ID)

const HOST_ID = makeSbUserId(1)
const HOST: SbUser = { id: HOST_ID, name: 'HostUser', created: 0 }

// A FULL map fixture, including everything the unauthenticated summary endpoint must strip
// (`mapUrl`, `hash`, `description`, `uploadedBy`, `visibility`, `imageVersion`, and the extra
// `mapData` fields beyond width/height).
const FULL_MAP_INFO: MapInfoJson = {
  id: makeSbMapId('map-1'),
  hash: 'deadbeef',
  name: 'Fighting Spirit',
  description: 'A classic 2-player map.',
  uploadedBy: makeSbUserId(7),
  uploadDate: 1234567890,
  visibility: MapVisibility.Official,
  mapData: {
    format: 'scm',
    tileset: Tileset.Jungle,
    originalName: 'Fighting Spirit',
    originalDescription: '',
    slots: 2,
    umsSlots: 0,
    umsForces: [],
    width: 128,
    height: 96,
    isEud: false,
    parserVersion: 1,
  },
  mapUrl: 'https://cdn.example.com/maps/fs.scm?signature=secret',
  image256Url: 'https://cdn.example.com/maps/fs-256.jpg',
  image512Url: 'https://cdn.example.com/maps/fs-512.jpg',
  image1024Url: 'https://cdn.example.com/maps/fs-1024.jpg',
  image2048Url: 'https://cdn.example.com/maps/fs-2048.jpg',
  imageVersion: 1,
}

const BASE_SUMMARY: LobbySummaryJson = {
  id: LOBBY_ID,
  name: 'Fastest Game Ever',
  map: FULL_MAP_INFO,
  gameType: GameType.Melee,
  gameSubType: 0,
  host: { id: HOST_ID },
  openSlotCount: 3,
}

/** A fake `RouterContext` satisfying `getSummary`'s param Joi validation. */
function makeSummaryCtx(): RouterContext {
  return { params: { lobbyId: LOBBY_PRETTY_ID } } as any
}

describe('lobbies/lobby-summary-api/LobbySummaryApi#getSummary', () => {
  let summaryGetterMock: ReturnType<typeof vi.fn<LobbySummaryGetter>>

  beforeEach(() => {
    findUsersByIdMock.mockReset()
    summaryGetterMock = vi.fn()
    setLobbySummaryGetter(summaryGetterMock)
  })

  test('strips the map down to only the fields the landing page needs', async () => {
    summaryGetterMock.mockReturnValueOnce(BASE_SUMMARY)
    findUsersByIdMock.mockResolvedValueOnce([HOST])

    const api = new LobbySummaryApi()
    const response = await api.getSummary(makeSummaryCtx())

    // The presigned `mapUrl`, and the uploader/hash/visibility details, must never re-enter this
    // unauthenticated response unnoticed -- if a field is added to MapInfoJson later, this list
    // won't silently grow to include it.
    expect(Object.keys(response.summary.map).sort()).toEqual(
      [
        'id',
        'image1024Url',
        'image2048Url',
        'image256Url',
        'image512Url',
        'mapData',
        'name',
      ].sort(),
    )
    expect(Object.keys(response.summary.map.mapData).sort()).toEqual(['height', 'width'].sort())
  })

  test('passes through the whitelisted map values unchanged', async () => {
    summaryGetterMock.mockReturnValueOnce(BASE_SUMMARY)
    findUsersByIdMock.mockResolvedValueOnce([HOST])

    const api = new LobbySummaryApi()
    const response = await api.getSummary(makeSummaryCtx())

    expect(response.summary.map).toEqual({
      id: FULL_MAP_INFO.id,
      name: FULL_MAP_INFO.name,
      image256Url: FULL_MAP_INFO.image256Url,
      image512Url: FULL_MAP_INFO.image512Url,
      image1024Url: FULL_MAP_INFO.image1024Url,
      image2048Url: FULL_MAP_INFO.image2048Url,
      mapData: { width: FULL_MAP_INFO.mapData.width, height: FULL_MAP_INFO.mapData.height },
    })
  })
})
