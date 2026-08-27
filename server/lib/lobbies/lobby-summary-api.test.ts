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
import {
  LobbyIdByJoinCodeGetter,
  LobbyJoinCodeGetter,
  LobbySummaryGetter,
  setLobbyIdByJoinCodeGetter,
  setLobbyJoinCodeGetter,
  setLobbySummaryGetter,
} from './lobby-summaries'
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
  useLegacyLimits: false,
  playerSlots: { taken: 1, total: 4, open: 3 },
  observerSlots: { taken: 1, open: 2 },
  hasObserverTeam: true,
  occupantIds: [HOST_ID, makeSbUserId(9)],
  createdAt: 1234567890,
}

/** A fake `RouterContext` satisfying `getSummary`'s param validation. */
function makeSummaryCtx(): RouterContext {
  return { params: { lobbyId: LOBBY_PRETTY_ID } } as any
}

describe('lobbies/lobby-summary-api/LobbySummaryApi#getSummary', () => {
  let summaryGetterMock: ReturnType<typeof vi.fn<LobbySummaryGetter>>

  beforeEach(() => {
    findUsersByIdMock.mockReset()
    summaryGetterMock = vi.fn()
    setLobbySummaryGetter(summaryGetterMock)
    // No lobby has a join code registered unless a test says otherwise.
    setLobbyJoinCodeGetter(() => undefined)
  })

  test('strips the summary and map down to only the fields the landing page needs', async () => {
    summaryGetterMock.mockReturnValueOnce(BASE_SUMMARY)
    findUsersByIdMock.mockResolvedValueOnce([HOST])

    const api = new LobbySummaryApi()
    const response = await api.getSummary(makeSummaryCtx())

    // A field added to LobbySummaryJson later (e.g. a player list) must never silently join this
    // unauthenticated response -- nor may the ones it already carries but this endpoint withholds
    // (`occupantIds`, `observerSlots`, `hasObserverTeam`).
    expect(Object.keys(response.summary).sort()).toEqual(
      [
        'gameSubType',
        'gameType',
        'host',
        'id',
        'map',
        'name',
        'playerSlots',
        'useLegacyLimits',
      ].sort(),
    )
    expect(Object.keys(response.summary.host)).toEqual(['id'])
    expect(response.summary.playerSlots).toEqual(BASE_SUMMARY.playerSlots)

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

  test('returns 404 when there is no live lobby with the given id', async () => {
    summaryGetterMock.mockReturnValueOnce(undefined)

    const api = new LobbySummaryApi()

    await expect(api.getSummary(makeSummaryCtx())).rejects.toMatchObject({ status: 404 })
    expect(findUsersByIdMock).not.toHaveBeenCalled()
  })

  test('returns 404 (not 400) for a malformed lobby id', async () => {
    const api = new LobbySummaryApi()
    const ctx = { params: { lobbyId: 'not-a-pretty-id!!' } } as any

    await expect(api.getSummary(ctx)).rejects.toMatchObject({ status: 404 })
    // A malformed id can never match a live lobby, so it's indistinguishable from "not found" --
    // the getter must not even be consulted.
    expect(summaryGetterMock).not.toHaveBeenCalled()
  })

  test('returns 404 when the host user cannot be resolved', async () => {
    summaryGetterMock.mockReturnValueOnce(BASE_SUMMARY)
    findUsersByIdMock.mockResolvedValueOnce([])

    const api = new LobbySummaryApi()

    await expect(api.getSummary(makeSummaryCtx())).rejects.toMatchObject({ status: 404 })
  })

  test('carries the join code at the top level of the response when one is registered', async () => {
    summaryGetterMock.mockReturnValueOnce(BASE_SUMMARY)
    findUsersByIdMock.mockResolvedValueOnce([HOST])
    setLobbyJoinCodeGetter(id => (id === LOBBY_ID ? 'BQ4XM9' : undefined))

    const api = new LobbySummaryApi()
    const response = await api.getSummary(makeSummaryCtx())

    expect(response.joinCode).toBe('BQ4XM9')
  })

  test('leaves the join code undefined when the lobby has none registered', async () => {
    summaryGetterMock.mockReturnValueOnce(BASE_SUMMARY)
    findUsersByIdMock.mockResolvedValueOnce([HOST])

    const api = new LobbySummaryApi()
    const response = await api.getSummary(makeSummaryCtx())

    expect(response.joinCode).toBeUndefined()
  })
})

describe('lobbies/lobby-summary-api/LobbySummaryApi#getByJoinCode', () => {
  let summaryGetterMock: ReturnType<typeof vi.fn<LobbySummaryGetter>>
  let joinCodeGetterMock: ReturnType<typeof vi.fn<LobbyJoinCodeGetter>>
  let idByJoinCodeGetterMock: ReturnType<typeof vi.fn<LobbyIdByJoinCodeGetter>>

  /** A fake `RouterContext` satisfying `getByJoinCode`'s route param shape. */
  function makeJoinCodeCtx(code: string): RouterContext {
    return { params: { code } } as any
  }

  beforeEach(() => {
    findUsersByIdMock.mockReset()
    summaryGetterMock = vi.fn()
    setLobbySummaryGetter(summaryGetterMock)
    joinCodeGetterMock = vi.fn()
    setLobbyJoinCodeGetter(joinCodeGetterMock)
    idByJoinCodeGetterMock = vi.fn()
    setLobbyIdByJoinCodeGetter(idByJoinCodeGetterMock)
  })

  test('resolves a well-formed code to the same response shape as the summary endpoint', async () => {
    idByJoinCodeGetterMock.mockReturnValueOnce(LOBBY_ID)
    summaryGetterMock.mockReturnValueOnce(BASE_SUMMARY)
    findUsersByIdMock.mockResolvedValueOnce([HOST])
    joinCodeGetterMock.mockReturnValueOnce('BQ4XM9')

    const api = new LobbySummaryApi()
    const response = await api.getByJoinCode(makeJoinCodeCtx('BQ4XM9'))

    expect(idByJoinCodeGetterMock).toHaveBeenCalledWith('BQ4XM9')
    expect(response.summary.id).toBe(LOBBY_ID)
    expect(response.host).toEqual(HOST)
    expect(response.joinCode).toBe('BQ4XM9')
  })

  test('normalizes permissive input (case, spaces, dash) before resolving', async () => {
    idByJoinCodeGetterMock.mockReturnValueOnce(LOBBY_ID)
    summaryGetterMock.mockReturnValueOnce(BASE_SUMMARY)
    findUsersByIdMock.mockResolvedValueOnce([HOST])

    const api = new LobbySummaryApi()
    await api.getByJoinCode(makeJoinCodeCtx(' bq4 - xm9 '))

    expect(idByJoinCodeGetterMock).toHaveBeenCalledWith('BQ4XM9')
  })

  test('returns 404 (not 400) for a malformed code without consulting the resolver', async () => {
    const api = new LobbySummaryApi()

    // Too short, and also carries a character ('O') outside the join code alphabet -- either
    // reason alone is enough to reject it as malformed before any lookup happens.
    await expect(api.getByJoinCode(makeJoinCodeCtx('BQ4XO'))).rejects.toMatchObject({
      status: 404,
    })
    expect(idByJoinCodeGetterMock).not.toHaveBeenCalled()
  })

  test('returns 404 when the code does not resolve to a live lobby', async () => {
    idByJoinCodeGetterMock.mockReturnValueOnce(undefined)

    const api = new LobbySummaryApi()

    await expect(api.getByJoinCode(makeJoinCodeCtx('BQ4XM9'))).rejects.toMatchObject({
      status: 404,
    })
    expect(summaryGetterMock).not.toHaveBeenCalled()
  })

  test('returns 404 when the resolved lobby no longer exists', async () => {
    idByJoinCodeGetterMock.mockReturnValueOnce(LOBBY_ID)
    summaryGetterMock.mockReturnValueOnce(undefined)

    const api = new LobbySummaryApi()

    await expect(api.getByJoinCode(makeJoinCodeCtx('BQ4XM9'))).rejects.toMatchObject({
      status: 404,
    })
  })

  test('returns 404 when the resolved lobby has no resolvable host', async () => {
    idByJoinCodeGetterMock.mockReturnValueOnce(LOBBY_ID)
    summaryGetterMock.mockReturnValueOnce(BASE_SUMMARY)
    findUsersByIdMock.mockResolvedValueOnce([])

    const api = new LobbySummaryApi()

    await expect(api.getByJoinCode(makeJoinCodeCtx('BQ4XM9'))).rejects.toMatchObject({
      status: 404,
    })
  })
})
