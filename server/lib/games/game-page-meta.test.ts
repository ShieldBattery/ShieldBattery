import { beforeEach, describe, expect, test, vi } from 'vitest'
import { GameSource } from '../../../common/games/configuration'
import { GameType } from '../../../common/games/game-type'
import { GameRecord } from '../../../common/games/games'
import { makeSbMapId, MapInfo } from '../../../common/maps'
import { MatchmakingType } from '../../../common/matchmaking'
import { encodePrettyId } from '../../../common/pretty-id'
import { asMockedFunction } from '../../../common/testing/mocks'
import { SbUser } from '../../../common/users/sb-user'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { getMapInfos } from '../maps/map-models'
import { PageMetadataContext } from '../page-metadata/page-metadata'
import { findUsersByIdAsMap } from '../users/user-model'
import { getGameRecord } from './game-models'
import { gamePageMetadata } from './game-page-meta'

vi.mock('./game-models', () => ({
  getGameRecord: vi.fn(),
}))

vi.mock('../users/user-model', () => ({
  findUsersByIdAsMap: vi.fn(),
}))

vi.mock('../maps/map-models', () => ({
  getMapInfos: vi.fn(),
}))

const getGameRecordMock = asMockedFunction(getGameRecord)
const findUsersByIdAsMapMock = asMockedFunction(findUsersByIdAsMap)
const getMapInfosMock = asMockedFunction(getMapInfos)

const CONTEXT: PageMetadataContext = {
  canonicalHost: 'https://shieldbattery.net',
  publicAssetsUrl: 'https://cdn.example.com/public/',
}

const GAME_ID = '5eed0000-0000-0000-0000-000000000042'
const PRETTY_ID = encodePrettyId(GAME_ID)
const MAP_ID = makeSbMapId('map-1')

const ALICE_ID = makeSbUserId(1)
const BOB_ID = makeSbUserId(2)

const ALICE: SbUser = { id: ALICE_ID, name: 'Alice', created: 0 }
const BOB: SbUser = { id: BOB_ID, name: 'Bob', created: 0 }

const FIGHTING_SPIRIT: MapInfo = {
  id: MAP_ID,
  name: 'Fighting Spirit',
  image1024Url: 'https://cdn.example.com/maps/fs-1024.jpg',
  image512Url: 'https://cdn.example.com/maps/fs-512.jpg',
  image256Url: 'https://cdn.example.com/maps/fs-256.jpg',
} as MapInfo

const BASE_GAME: GameRecord = {
  id: GAME_ID,
  startTime: new Date('2026-07-14T12:00:00.000Z'),
  mapId: MAP_ID,
  config: {
    gameSource: GameSource.Matchmaking,
    gameSourceExtra: { type: MatchmakingType.Match1v1 },
    gameType: GameType.Melee,
    gameSubType: 0,
    teams: [
      [{ id: ALICE_ID, race: 'z', isComputer: false }],
      [{ id: BOB_ID, race: 't', isComputer: false }],
    ],
  },
  disputable: false,
  disputeRequested: false,
  disputeReviewed: false,
  gameLength: 600,
  results: null,
  selectedMatchup: null,
  assignedMatchup: null,
}

describe('games/game-page-meta', () => {
  describe('gamePageMetadata', () => {
    beforeEach(() => {
      getGameRecordMock.mockReset()
      findUsersByIdAsMapMock.mockReset()
      getMapInfosMock.mockReset()
    })

    test('returns undefined for a malformed id without querying the model', async () => {
      expect(await gamePageMetadata({ id: GAME_ID }, CONTEXT)).toBeUndefined()
      expect(await gamePageMetadata({ id: 'not-a-pretty-id-at-all!' }, CONTEXT)).toBeUndefined()
      expect(await gamePageMetadata({ id: undefined }, CONTEXT)).toBeUndefined()

      expect(getGameRecordMock).not.toHaveBeenCalled()
    })

    test('returns undefined when the game is not found', async () => {
      getGameRecordMock.mockResolvedValueOnce(undefined)

      const result = await gamePageMetadata({ id: PRETTY_ID }, CONTEXT)

      expect(result).toBeUndefined()
    })

    test('resolves a matchmaking 1v1 game', async () => {
      getGameRecordMock.mockResolvedValueOnce({ ...BASE_GAME })
      findUsersByIdAsMapMock.mockResolvedValueOnce(
        new Map([
          [ALICE_ID, ALICE],
          [BOB_ID, BOB],
        ]),
      )
      getMapInfosMock.mockResolvedValueOnce([FIGHTING_SPIRIT])

      const result = await gamePageMetadata({ id: PRETTY_ID }, CONTEXT)

      expect(result?.url).toBe(`https://shieldbattery.net/games/${PRETTY_ID}`)
      expect(result?.type).toBe('website')
      expect(result?.title).toBe('Alice vs Bob')
      expect(result?.description).toBe('Ranked 1v1 game on Fighting Spirit, played July 14, 2026.')
      expect(result?.image).toBe('https://cdn.example.com/maps/fs-1024.jpg')
      expect(findUsersByIdAsMapMock).toHaveBeenCalledWith([ALICE_ID, BOB_ID])
      expect(getMapInfosMock).toHaveBeenCalledWith([MAP_ID])
    })

    test('resolves a lobby game with computer players', async () => {
      getGameRecordMock.mockResolvedValueOnce({
        ...BASE_GAME,
        config: {
          gameSource: GameSource.Lobby,
          gameType: GameType.TeamMelee,
          gameSubType: 0,
          teams: [
            [
              { id: ALICE_ID, race: 'z', isComputer: false },
              { id: BOB_ID, race: 't', isComputer: false },
            ],
            [
              { id: makeSbUserId(3), race: 'p', isComputer: true },
              { id: makeSbUserId(4), race: 'p', isComputer: true },
            ],
          ],
        },
      })
      findUsersByIdAsMapMock.mockResolvedValueOnce(
        new Map([
          [ALICE_ID, ALICE],
          [BOB_ID, BOB],
        ]),
      )
      getMapInfosMock.mockResolvedValueOnce([FIGHTING_SPIRIT])

      const result = await gamePageMetadata({ id: PRETTY_ID }, CONTEXT)

      expect(result?.title).toBe('Alice, Bob vs Computer, Computer')
      expect(result?.description).toBe('Custom game on Fighting Spirit, played July 14, 2026.')
    })

    test('falls back to "Unknown Map" and the default image when the map row is missing', async () => {
      getGameRecordMock.mockResolvedValueOnce({ ...BASE_GAME })
      findUsersByIdAsMapMock.mockResolvedValueOnce(
        new Map([
          [ALICE_ID, ALICE],
          [BOB_ID, BOB],
        ]),
      )
      getMapInfosMock.mockResolvedValueOnce([])

      const result = await gamePageMetadata({ id: PRETTY_ID }, CONTEXT)

      expect(result?.title).toBe('Alice vs Bob')
      expect(result?.description).toBe('Ranked 1v1 game on Unknown Map, played July 14, 2026.')
      expect(result?.image).toBe('https://shieldbattery.net/images/logo-and-text-1200x630.png')
    })
  })
})
