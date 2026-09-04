import got, { OptionsOfTextResponseBody } from 'got'
import { Readable } from 'stream'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { GameRecord } from '../../../common/games/games'
import { MapInfo, makeSbMapId } from '../../../common/maps'
import { asMockedFunction } from '../../../common/testing/mocks'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { readFileStream } from '../files'
import {
  InternalApiTestServer,
  startInternalApiTestServer,
} from '../http/testing/internal-api-server'
import { getMapInfos } from '../maps/map-models'
import { getAllReplaysForGame } from '../replays/replay-models'
import { getGameRecord, getNetcodeV2Session } from './game-models'
import { InternalGameArtifactApi } from './internal-game-artifact-api'

vi.mock('./game-models', () => ({
  getGameRecord: vi.fn(),
  getNetcodeV2Session: vi.fn(),
}))
vi.mock('../replays/replay-models', () => ({
  getAllReplaysForGame: vi.fn(),
}))
vi.mock('../maps/map-models', () => ({
  getMapInfos: vi.fn(),
}))
vi.mock('../files', () => ({
  readFileStream: vi.fn(),
}))

const mockGetGameRecord = asMockedFunction(getGameRecord)
const mockGetNetcodeV2Session = asMockedFunction(getNetcodeV2Session)
const mockGetAllReplaysForGame = asMockedFunction(getAllReplaysForGame)
const mockGetMapInfos = asMockedFunction(getMapInfos)
const mockReadFileStream = asMockedFunction(readFileStream)

const GAME_ID = '11111111-2222-4333-8444-555555555555'
const MAP_ID = makeSbMapId('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee')
const REPLAY_ID = '99999999-8888-4777-8666-555555555555'
const MAP_HASH = 'ab'.repeat(32)

const GAME: GameRecord = {
  id: GAME_ID,
  startTime: new Date(1787700000000),
  mapId: MAP_ID,
  config: {} as any,
  disputable: false,
  disputeRequested: false,
  disputeReviewed: false,
  gameLength: 1000,
  results: null,
  selectedMatchup: null,
  assignedMatchup: null,
  manuallyResolved: false,
}

const MAP: MapInfo = {
  id: MAP_ID,
  hash: MAP_HASH,
  name: 'Fighting Spirit',
  description: '',
  uploadedBy: makeSbUserId(1),
  uploadDate: new Date(1787600000000),
  visibility: 'OFFICIAL' as any,
  mapData: { format: 'scx' } as any,
  mapUrl: 'https://store.example/signed-map-url?sig=secret',
  imageVersion: 1,
}

const REPLAY = {
  id: REPLAY_ID,
  hash: Buffer.from('cd'.repeat(32), 'hex'),
  size: 12345,
  uploadedAt: new Date(1787700100000),
  uploadedBy: makeSbUserId(7),
  parserVersion: 1,
  header: { frames: 4200 } as any,
  slots: [],
  sbData: null,
  uploadedByGameUserId: makeSbUserId(7),
}

const NO_THROW: OptionsOfTextResponseBody = { throwHttpErrors: false, retry: { limit: 0 } }

describe('games/internal-game-artifact-api', () => {
  let server: InternalApiTestServer
  let baseUrl: string
  let netcodeV2Service: {
    isEnabled: ReturnType<typeof vi.fn>
    listFlightBlobs: ReturnType<typeof vi.fn>
    fetchFlightBlob: ReturnType<typeof vi.fn>
  }

  beforeEach(async () => {
    vi.clearAllMocks()

    netcodeV2Service = {
      isEnabled: vi.fn().mockReturnValue(true),
      listFlightBlobs: vi.fn().mockResolvedValue([]),
      fetchFlightBlob: vi.fn(),
    }
    mockGetGameRecord.mockResolvedValue(GAME)
    mockGetNetcodeV2Session.mockResolvedValue(42)
    mockGetAllReplaysForGame.mockResolvedValue([REPLAY])
    mockGetMapInfos.mockResolvedValue([MAP])

    server = await startInternalApiTestServer([
      new InternalGameArtifactApi(netcodeV2Service as any),
    ])
    baseUrl = server.baseUrl
  })

  afterEach(async () => {
    await server.close()
  })

  describe('manifest', () => {
    test('lists flight recordings, replays, and the map with internal download paths', async () => {
      netcodeV2Service.listFlightBlobs.mockResolvedValue([
        { relayId: 7, pinned: true, size: 2048, lastModifiedMs: 1787700200000 },
      ])

      const res = await got(`${baseUrl}/internal/games/${GAME_ID}/artifacts`, NO_THROW)

      expect(res.statusCode).toBe(200)
      expect(res.headers['cache-control']).toBe('private, no-store')
      expect(res.headers['x-content-type-options']).toBe('nosniff')
      expect(JSON.parse(res.body)).toEqual({
        gameId: GAME_ID,
        flightRecordings: [
          {
            relayId: 7,
            pinned: true,
            size: 2048,
            lastModifiedMs: 1787700200000,
            downloadPath: `/internal/games/${GAME_ID}/artifacts/flight-recordings/7`,
          },
        ],
        replays: [
          {
            id: REPLAY_ID,
            uploaderUserId: 7,
            size: 12345,
            sha256: 'cd'.repeat(32),
            frames: 4200,
            downloadPath: `/internal/games/${GAME_ID}/artifacts/replays/${REPLAY_ID}`,
          },
        ],
        map: {
          id: MAP_ID,
          hash: MAP_HASH,
          format: 'scx',
          name: 'Fighting Spirit',
          downloadPath: `/internal/games/${GAME_ID}/artifacts/map`,
        },
      })
      // The stored session id (never anything caller-supplied) is what's listed.
      expect(netcodeV2Service.listFlightBlobs).toHaveBeenCalledWith(42)
      // The map record carries a signed object-store URL; it must not leak into the manifest.
      expect(res.body).not.toContain('signed-map-url')
    })

    test('reports no flight recordings when the game has no netcode v2 session', async () => {
      mockGetNetcodeV2Session.mockResolvedValue(null)

      const res = await got(`${baseUrl}/internal/games/${GAME_ID}/artifacts`, NO_THROW)

      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.body).flightRecordings).toEqual([])
      expect(netcodeV2Service.listFlightBlobs).not.toHaveBeenCalled()
    })

    test('reports no flight recordings when netcode v2 is disabled, without a session lookup', async () => {
      netcodeV2Service.isEnabled.mockReturnValue(false)

      const res = await got(`${baseUrl}/internal/games/${GAME_ID}/artifacts`, NO_THROW)

      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.body).flightRecordings).toEqual([])
      expect(mockGetNetcodeV2Session).not.toHaveBeenCalled()
      expect(netcodeV2Service.listFlightBlobs).not.toHaveBeenCalled()
    })

    test('reports a null map when the map record is gone', async () => {
      mockGetMapInfos.mockResolvedValue([])

      const res = await got(`${baseUrl}/internal/games/${GAME_ID}/artifacts`, NO_THROW)

      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.body).map).toBeNull()
    })

    test('404s an unknown game', async () => {
      mockGetGameRecord.mockResolvedValue(undefined)

      const res = await got(`${baseUrl}/internal/games/${GAME_ID}/artifacts`, NO_THROW)

      expect(res.statusCode).toBe(404)
      expect(mockGetAllReplaysForGame).not.toHaveBeenCalled()
    })

    test('400s a malformed game id without querying', async () => {
      const res = await got(`${baseUrl}/internal/games/not-a-uuid/artifacts`, NO_THROW)

      expect(res.statusCode).toBe(400)
      expect(mockGetGameRecord).not.toHaveBeenCalled()
    })
  })

  describe('flight recording download', () => {
    test('serves the recording text for the stored session and requested relay', async () => {
      const recording = JSON.stringify({ events: ['connect', 'leave'] })
      netcodeV2Service.fetchFlightBlob.mockResolvedValue(recording)

      const res = await got(
        `${baseUrl}/internal/games/${GAME_ID}/artifacts/flight-recordings/7`,
        NO_THROW,
      )

      expect(res.statusCode).toBe(200)
      expect(res.headers['content-type']).toBe('application/json')
      expect(res.headers['content-disposition']).toBe(
        `attachment; filename="${GAME_ID}-relay-7.json"`,
      )
      expect(res.headers['cache-control']).toBe('private, no-store')
      expect(res.headers['x-content-type-options']).toBe('nosniff')
      expect(res.body).toBe(recording)
      expect(netcodeV2Service.fetchFlightBlob).toHaveBeenCalledWith(42, 7)
    })

    test('404s when the coordinator has no blob for that relay', async () => {
      netcodeV2Service.fetchFlightBlob.mockResolvedValue(undefined)

      const res = await got(
        `${baseUrl}/internal/games/${GAME_ID}/artifacts/flight-recordings/7`,
        NO_THROW,
      )

      expect(res.statusCode).toBe(404)
    })

    test('404s when the game has no netcode v2 session', async () => {
      mockGetNetcodeV2Session.mockResolvedValue(null)

      const res = await got(
        `${baseUrl}/internal/games/${GAME_ID}/artifacts/flight-recordings/7`,
        NO_THROW,
      )

      expect(res.statusCode).toBe(404)
      expect(netcodeV2Service.fetchFlightBlob).not.toHaveBeenCalled()
    })

    test('400s a malformed relay id without any lookups', async () => {
      const res = await got(
        `${baseUrl}/internal/games/${GAME_ID}/artifacts/flight-recordings/-1`,
        NO_THROW,
      )

      expect(res.statusCode).toBe(400)
      expect(mockGetGameRecord).not.toHaveBeenCalled()
      expect(netcodeV2Service.fetchFlightBlob).not.toHaveBeenCalled()
    })
  })

  describe('replay download', () => {
    test('streams a replay that belongs to the game', async () => {
      const bytes = Buffer.from('not really a replay', 'utf8')
      mockReadFileStream.mockResolvedValue({ stream: Readable.from([bytes]), size: bytes.length })

      const res = await got(`${baseUrl}/internal/games/${GAME_ID}/artifacts/replays/${REPLAY_ID}`, {
        ...NO_THROW,
        responseType: 'buffer',
      })

      expect(res.statusCode).toBe(200)
      expect(res.headers['content-type']).toBe('application/octet-stream')
      expect(res.headers['content-disposition']).toBe(`attachment; filename="${REPLAY_ID}.rep"`)
      expect(res.headers['content-length']).toBe(String(bytes.length))
      expect(res.headers['cache-control']).toBe('private, no-store')
      expect(res.headers['x-content-type-options']).toBe('nosniff')
      expect(Buffer.compare(res.body, bytes)).toBe(0)
      expect(mockReadFileStream).toHaveBeenCalledWith(`replays/${REPLAY_ID}.rep`)
    })

    test('matches the replay id case-insensitively', async () => {
      mockReadFileStream.mockResolvedValue({ stream: Readable.from([Buffer.from('rep')]), size: 3 })

      const res = await got(
        `${baseUrl}/internal/games/${GAME_ID}/artifacts/replays/${REPLAY_ID.toUpperCase()}`,
        NO_THROW,
      )

      expect(res.statusCode).toBe(200)
      expect(mockReadFileStream).toHaveBeenCalledWith(`replays/${REPLAY_ID}.rep`)
    })

    test('404s a replay that exists but belongs to a different game', async () => {
      const otherReplayId = '00000000-1111-4222-8333-444444444444'

      const res = await got(
        `${baseUrl}/internal/games/${GAME_ID}/artifacts/replays/${otherReplayId}`,
        NO_THROW,
      )

      expect(res.statusCode).toBe(404)
      expect(mockReadFileStream).not.toHaveBeenCalled()
    })

    test('400s a malformed replay id without any lookups', async () => {
      const res = await got(
        `${baseUrl}/internal/games/${GAME_ID}/artifacts/replays/not-a-uuid`,
        NO_THROW,
      )

      expect(res.statusCode).toBe(400)
      expect(mockGetGameRecord).not.toHaveBeenCalled()
      expect(mockReadFileStream).not.toHaveBeenCalled()
    })
  })

  describe('map download', () => {
    test('streams the map file the game was played on', async () => {
      const bytes = Buffer.from('not really a map', 'utf8')
      mockReadFileStream.mockResolvedValue({ stream: Readable.from([bytes]), size: bytes.length })

      const res = await got(`${baseUrl}/internal/games/${GAME_ID}/artifacts/map`, {
        ...NO_THROW,
        responseType: 'buffer',
      })

      expect(res.statusCode).toBe(200)
      expect(res.headers['content-type']).toBe('application/octet-stream')
      expect(res.headers['content-disposition']).toBe(`attachment; filename="${MAP_HASH}.scx"`)
      expect(res.headers['content-length']).toBe(String(bytes.length))
      expect(res.headers['cache-control']).toBe('private, no-store')
      expect(res.headers['x-content-type-options']).toBe('nosniff')
      expect(Buffer.compare(res.body, bytes)).toBe(0)
      expect(mockGetMapInfos).toHaveBeenCalledWith([MAP_ID])
      expect(mockReadFileStream).toHaveBeenCalledWith(`maps/ab/ab/${MAP_HASH}.scx`)
    })

    test('404s when the map record is gone', async () => {
      mockGetMapInfos.mockResolvedValue([])

      const res = await got(`${baseUrl}/internal/games/${GAME_ID}/artifacts/map`, NO_THROW)

      expect(res.statusCode).toBe(404)
      expect(mockReadFileStream).not.toHaveBeenCalled()
    })
  })
})
