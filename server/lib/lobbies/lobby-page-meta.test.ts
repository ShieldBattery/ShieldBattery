import { beforeEach, describe, expect, test, vi } from 'vitest'
import { GameType } from '../../../common/games/game-type'
import { LobbySummaryJson } from '../../../common/lobbies/lobby-network'
import { makeSbLobbyId } from '../../../common/lobbies/sb-lobby-id'
import { makeSbMapId, MapInfoJson } from '../../../common/maps'
import { encodePrettyId } from '../../../common/pretty-id'
import { asMockedFunction } from '../../../common/testing/mocks'
import { SbUser } from '../../../common/users/sb-user'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { defaultPageMetadata, PageMetadataContext } from '../page-metadata/page-metadata'
import { findUsersById } from '../users/user-model'
import { lobbyPageMetadata } from './lobby-page-meta'
import { LobbySummaryGetter, setLobbySummaryGetter } from './lobby-summaries'

vi.mock('../users/user-model', () => ({
  findUsersById: vi.fn(),
}))

const findUsersByIdMock = asMockedFunction(findUsersById)

const CONTEXT: PageMetadataContext = {
  canonicalHost: 'https://shieldbattery.net',
  publicAssetsUrl: 'https://cdn.example.com/public/',
}

const LOBBY_UUID = '5eed0000-0000-0000-0000-000000000042'
const LOBBY_PRETTY_ID = encodePrettyId(LOBBY_UUID)
const LOBBY_ID = makeSbLobbyId(LOBBY_PRETTY_ID)

const HOST_ID = makeSbUserId(1)
const HOST: SbUser = { id: HOST_ID, name: 'HostUser', created: 0 }

const FIGHTING_SPIRIT: MapInfoJson = {
  id: makeSbMapId('map-1'),
  name: 'Fighting Spirit',
  image1024Url: 'https://cdn.example.com/maps/fs-1024.jpg',
  image512Url: 'https://cdn.example.com/maps/fs-512.jpg',
  image256Url: 'https://cdn.example.com/maps/fs-256.jpg',
} as MapInfoJson

const BASE_SUMMARY: LobbySummaryJson = {
  id: LOBBY_ID,
  name: 'Fastest Game Ever',
  map: FIGHTING_SPIRIT,
  gameType: GameType.Melee,
  gameSubType: 0,
  host: { id: HOST_ID },
  openSlotCount: 3,
}

describe('lobbies/lobby-page-meta', () => {
  describe('lobbyPageMetadata', () => {
    // A plain spy (rather than a module mock) since the resolver reads through the
    // `lobby-summaries` seam, not a directly-importable model function.
    let summaryGetterMock: ReturnType<typeof vi.fn<LobbySummaryGetter>>

    beforeEach(() => {
      findUsersByIdMock.mockReset()
      summaryGetterMock = vi.fn()
      setLobbySummaryGetter(summaryGetterMock)
    })

    test('returns default metadata marked noindex for a malformed id without calling the summary getter', async () => {
      const expected = { ...defaultPageMetadata(CONTEXT), noindex: true }

      expect(await lobbyPageMetadata({ id: LOBBY_UUID }, CONTEXT)).toEqual(expected)
      expect(await lobbyPageMetadata({ id: 'not-a-pretty-id-at-all!' }, CONTEXT)).toEqual(expected)
      expect(await lobbyPageMetadata({ id: undefined }, CONTEXT)).toEqual(expected)

      expect(summaryGetterMock).not.toHaveBeenCalled()
    })

    test('returns default metadata marked noindex when there is no live lobby with that id', async () => {
      summaryGetterMock.mockReturnValueOnce(undefined)

      const result = await lobbyPageMetadata({ id: LOBBY_PRETTY_ID }, CONTEXT)

      expect(result).toEqual({ ...defaultPageMetadata(CONTEXT), noindex: true })
      expect(summaryGetterMock).toHaveBeenCalledWith(LOBBY_ID)
    })

    test('returns default metadata marked noindex when the lobby summary lookup throws', async () => {
      summaryGetterMock.mockReturnValueOnce(BASE_SUMMARY)
      findUsersByIdMock.mockRejectedValueOnce(new Error('db is down'))

      const result = await lobbyPageMetadata({ id: LOBBY_PRETTY_ID }, CONTEXT)

      expect(result).toEqual({ ...defaultPageMetadata(CONTEXT), noindex: true })
    })

    test('returns default metadata marked noindex when the host user cannot be resolved', async () => {
      summaryGetterMock.mockReturnValueOnce(BASE_SUMMARY)
      findUsersByIdMock.mockResolvedValueOnce([])

      const result = await lobbyPageMetadata({ id: LOBBY_PRETTY_ID }, CONTEXT)

      expect(result).toEqual({ ...defaultPageMetadata(CONTEXT), noindex: true })
    })

    test('resolves a live lobby', async () => {
      summaryGetterMock.mockReturnValueOnce(BASE_SUMMARY)
      findUsersByIdMock.mockResolvedValueOnce([HOST])

      const result = await lobbyPageMetadata({ id: LOBBY_PRETTY_ID }, CONTEXT)

      expect(result).toEqual({
        url: `https://shieldbattery.net/lobbies/${LOBBY_PRETTY_ID}/fastest-game-ever`,
        type: 'website',
        title: 'Fastest Game Ever',
        description: 'Melee lobby on Fighting Spirit — 3 open slots. Hosted by HostUser.',
        image: 'https://cdn.example.com/maps/fs-1024.jpg',
        noindex: true,
      })
      expect(findUsersByIdMock).toHaveBeenCalledWith([HOST_ID])
    })

    test('singularizes the description when there is exactly one open slot', async () => {
      summaryGetterMock.mockReturnValueOnce({ ...BASE_SUMMARY, openSlotCount: 1 })
      findUsersByIdMock.mockResolvedValueOnce([HOST])

      const result = await lobbyPageMetadata({ id: LOBBY_PRETTY_ID }, CONTEXT)

      expect(result?.description).toBe(
        'Melee lobby on Fighting Spirit — 1 open slot. Hosted by HostUser.',
      )
    })

    test('falls back to the default page image when the map has no image', async () => {
      summaryGetterMock.mockReturnValueOnce({
        ...BASE_SUMMARY,
        map: {
          ...FIGHTING_SPIRIT,
          image1024Url: undefined,
          image512Url: undefined,
          image256Url: undefined,
        },
      })
      findUsersByIdMock.mockResolvedValueOnce([HOST])

      const result = await lobbyPageMetadata({ id: LOBBY_PRETTY_ID }, CONTEXT)

      expect(result?.image).toBe('https://shieldbattery.net/images/logo-and-text-1200x630.png')
    })
  })
})
