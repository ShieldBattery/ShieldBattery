import { NydusServer } from 'nydus'
import { Result } from 'typescript-result'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import createDeferred, { Deferred } from '../../../common/async/deferred'
import { GameSource } from '../../../common/games/configuration'
import { GameType } from '../../../common/games/game-type'
import { makeSbMapId, MapInfo, MapVisibility, Tileset } from '../../../common/maps'
import {
  SoloGameEvent,
  SoloGameLaunchFailure,
  SoloGameServiceErrorCode,
} from '../../../common/solo-games'
import { asMockedFunction } from '../../../common/testing/mocks'
import { FriendActivityStatus } from '../../../common/users/relationships'
import { SbUser } from '../../../common/users/sb-user'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import {
  BaseGameLoaderError,
  GameLoader,
  GameLoaderError,
  GameLoadErrorType,
  GameLoadRequest,
  GameLoadResult,
} from '../games/game-loader'
import { GameplayActivityRegistry } from '../games/gameplay-activity-registry'
import logger from '../logging/logger'
import { getMapInfos } from '../maps/map-models'
import { FakeClock } from '../time/testing/fake-clock'
import {
  ActivityStatusService,
  getFriendActivityStatusPath,
} from '../users/activity-status-service'
import { RequestSessionLookup } from '../websockets/session-lookup'
import {
  ClientSocketsGroup,
  ClientSocketsManager,
  UserSocketsManager,
} from '../websockets/socket-groups'
import {
  clearTestLogs,
  createFakeNydusServer,
  FakeNydusServer,
  InspectableNydusClient,
  NydusConnector,
} from '../websockets/testing/websockets'
import { TypedPublisher } from '../websockets/typed-publisher'
import { getSoloGamesPath, SoloGameService } from './solo-game-service'
import { SoloGameServiceError } from './solo-game-service-error'
import { buildSoloGameSlots } from './solo-game-slots'

vi.mock('../maps/map-models', () => ({ getMapInfos: vi.fn() }))
vi.mock('../logging/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const USER: SbUser = { id: makeSbUserId(7), name: 'Soloist' } as SbUser
const GAME_ID = 'solo-game-id'

const UMS_MAP: MapInfo = {
  id: makeSbMapId('marine-training'),
  hash: 'abc',
  name: 'Marine Training',
  description: '',
  kind: 'ums',
  visibility: MapVisibility.Public,
  mapData: {
    format: 'scx',
    tileset: Tileset.Jungle,
    originalName: 'Marine Training',
    originalDescription: '',
    slots: 3,
    umsSlots: 3,
    umsForces: [
      {
        name: 'Players',
        teamId: 1,
        players: [
          { id: 0, race: 'any', typeId: 6, computer: false },
          { id: 1, race: 't', typeId: 6, computer: false },
        ],
      },
      { name: 'Enemy', teamId: 2, players: [{ id: 2, race: 'z', typeId: 5, computer: true }] },
    ],
    width: 64,
    height: 64,
    isEud: false,
    startLocations: [],
    parserVersion: 1,
  },
  imageVersion: 1,
  imageSpawnsBaked: true,
}

const MELEE_MAP: MapInfo = { ...UMS_MAP, id: makeSbMapId('melee'), kind: 'melee' }

const NO_COMPUTER_MAP: MapInfo = {
  ...UMS_MAP,
  id: makeSbMapId('no-computer'),
  mapData: {
    ...UMS_MAP.mapData,
    umsForces: [UMS_MAP.mapData.umsForces[0]],
  },
}

const MAPS = [UMS_MAP, MELEE_MAP, NO_COMPUTER_MAP]

describe('solo-games/solo-game-service', () => {
  let nydus: NydusServer
  let fakeNydus: FakeNydusServer
  let clientSockets: ClientSocketsManager
  let activityStatusService: ActivityStatusService
  let activityRegistry: GameplayActivityRegistry
  let service: SoloGameService

  let socket: InspectableNydusClient
  let client: ClientSocketsGroup

  let loadRequests: GameLoadRequest[]
  let loadResult: Deferred<Result<GameLoadResult, GameLoaderError>>
  let connector: NydusConnector
  let gameLoader: {
    loadGame: ReturnType<typeof vi.fn<(request: GameLoadRequest) => unknown>>
    cancelLoadingWithoutBlame: ReturnType<typeof vi.fn<(gameId: string) => boolean>>
  }

  /** Lets work kicked off by a settled load run out. */
  async function flushAsync() {
    await new Promise(resolve => setImmediate(resolve))
  }

  /** The events the launching client was sent about its launch. */
  function soloEvents(): SoloGameEvent[] {
    return asMockedFunction(socket.publish)
      .mock.calls.filter(([path]) => path === getSoloGamesPath(USER.id))
      .map(([, data]) => data)
  }

  /** Every friend-visible status published for the user. */
  function statusPublishes(): FriendActivityStatus[] {
    return fakeNydus.publish.mock.calls
      .filter(([path]) => path === getFriendActivityStatusPath(USER.id))
      .map(([, data]) => data.status)
  }

  function isSubscribed() {
    return client.subscriptions.has(getSoloGamesPath(USER.id))
  }

  async function expectRefusal(promise: Promise<unknown>, code: SoloGameServiceErrorCode) {
    const err = await promise.then(
      () => undefined,
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(SoloGameServiceError)
    expect((err as SoloGameServiceError).code).toBe(code)
  }

  beforeEach(() => {
    nydus = createFakeNydusServer()
    fakeNydus = nydus as unknown as FakeNydusServer
    const sessionLookup = new RequestSessionLookup()
    clientSockets = new ClientSocketsManager(nydus, sessionLookup)
    const userSockets = new UserSocketsManager(nydus, sessionLookup, async () => {})
    activityStatusService = new ActivityStatusService(
      new TypedPublisher(nydus),
      userSockets,
      clientSockets,
      new FakeClock(),
    )
    activityRegistry = new GameplayActivityRegistry(activityStatusService)

    vi.clearAllMocks()
    loadRequests = []
    loadResult = createDeferred()
    gameLoader = {
      loadGame: vi.fn((request: GameLoadRequest) => {
        loadRequests.push(request)
        return loadResult
      }),
      cancelLoadingWithoutBlame: vi.fn((_gameId: string) => true),
    }
    service = new SoloGameService(
      activityRegistry,
      activityStatusService,
      gameLoader as unknown as GameLoader,
      new TypedPublisher(nydus),
    )

    asMockedFunction(getMapInfos).mockImplementation(async ids =>
      MAPS.filter(map => ids.includes(map.id)),
    )

    connector = new NydusConnector(nydus, sessionLookup)
    socket = connector.connectClient(USER, 'APP_CLIENT')
    client = clientSockets.getById(USER.id, 'APP_CLIENT')!
    clearTestLogs(nydus)
  })

  test('loads the game with its one player, its slots and a solo config', async () => {
    await service.launch({ client, mapId: UMS_MAP.id, slot: 1 })

    expect(loadRequests).toHaveLength(1)
    const [request] = loadRequests
    const expected = buildSoloGameSlots({ map: UMS_MAP, userId: USER.id, slot: 1 })
    expect(request.players).toEqual([{ userId: USER.id, isObserver: false }])
    expect(request.mapId).toBe(UMS_MAP.id)
    expect(request.playerInfos.map(({ id: _id, ...rest }) => rest)).toEqual(
      expected.playerInfos.map(({ id: _id, ...rest }) => rest),
    )
    expect(request.gameConfig).toEqual({
      gameSource: GameSource.Solo,
      gameType: GameType.UseMapSettings,
      gameSubType: 0,
      teams: expected.teams,
      lockedAlliances: false,
    })
    expect(request.signal).toBeUndefined()
  })

  test('holds the gameplay activity while loading without changing what friends see', async () => {
    await service.launch({ client, mapId: UMS_MAP.id })

    expect(activityRegistry.getClientForUser(USER.id)).toBe(client)
    expect(isSubscribed()).toBe(true)
    expect(activityStatusService.getStatus(USER.id)).toBe(FriendActivityStatus.Online)
    expect(statusPublishes()).toEqual([])
    expect(soloEvents()).toEqual([])
  })

  test('tells the client the game started, then lets go of the activity', async () => {
    await service.launch({ client, mapId: UMS_MAP.id })

    loadResult.resolve(Result.ok({ gameId: GAME_ID }))
    await flushAsync()

    expect(soloEvents()).toEqual([{ type: 'gameStarted', gameId: GAME_ID }])
    expect(activityRegistry.getClientForUser(USER.id)).toBeUndefined()
    expect(isSubscribed()).toBe(false)
    expect(statusPublishes()).toEqual([])
  })

  test.each([
    [
      new BaseGameLoaderError(GameLoadErrorType.Timeout, 'timed out', {
        data: { unloaded: [USER.id] },
      }),
      SoloGameLaunchFailure.Timeout,
    ],
    [
      new BaseGameLoaderError(GameLoadErrorType.PlayerFailed, 'failed', {
        data: { userId: USER.id },
      }),
      SoloGameLaunchFailure.ClientFailed,
    ],
    [new BaseGameLoaderError(GameLoadErrorType.Internal, 'broke'), SoloGameLaunchFailure.Internal],
    [
      new BaseGameLoaderError(GameLoadErrorType.Canceled, 'canceled'),
      SoloGameLaunchFailure.Internal,
    ],
  ] as const)(
    'tells the client the launch failed (%s), then lets go of the activity',
    async (error, reason) => {
      await service.launch({ client, mapId: UMS_MAP.id })

      loadResult.resolve(Result.error(error as GameLoaderError))
      await flushAsync()

      expect(soloEvents()).toEqual([{ type: 'launchFailed', reason }])
      expect(activityRegistry.getClientForUser(USER.id)).toBeUndefined()
      expect(isSubscribed()).toBe(false)
    },
  )

  test('lets the user launch again once a launch has settled', async () => {
    await service.launch({ client, mapId: UMS_MAP.id })
    loadResult.resolve(
      Result.error(new BaseGameLoaderError(GameLoadErrorType.Internal, 'broke') as GameLoaderError),
    )
    await flushAsync()

    loadResult = createDeferred()
    await service.launch({ client, mapId: UMS_MAP.id })
    expect(loadRequests).toHaveLength(2)
  })

  describe('refuses without changing anything', () => {
    function expectNothingChanged() {
      expect(gameLoader.loadGame).not.toHaveBeenCalled()
      expect(activityRegistry.getClientForUser(USER.id)).toBeUndefined()
      expect(isSubscribed()).toBe(false)
      expect(statusPublishes()).toEqual([])
    }

    test('an unknown map', async () => {
      await expectRefusal(
        service.launch({ client, mapId: makeSbMapId('nope') }),
        SoloGameServiceErrorCode.MapNotFound,
      )
      expectNothingChanged()
    })

    test('a melee map', async () => {
      await expectRefusal(
        service.launch({ client, mapId: MELEE_MAP.id }),
        SoloGameServiceErrorCode.MapNotPlayableAlone,
      )
      expectNothingChanged()
    })

    test('a map without a computer slot', async () => {
      await expectRefusal(
        service.launch({ client, mapId: NO_COMPUTER_MAP.id }),
        SoloGameServiceErrorCode.MapNotPlayableAlone,
      )
      expectNothingChanged()
    })

    test('a computer slot', async () => {
      await expectRefusal(
        service.launch({ client, mapId: UMS_MAP.id, slot: 2 }),
        SoloGameServiceErrorCode.InvalidSlot,
      )
      expectNothingChanged()
    })

    test('a race the slot cannot have', async () => {
      await expectRefusal(
        service.launch({ client, mapId: UMS_MAP.id, slot: 1, race: 'p' }),
        SoloGameServiceErrorCode.InvalidRace,
      )
      expectNothingChanged()
    })

    test('a disconnected client', async () => {
      socket.disconnect()
      // Going offline is published for the disconnect itself
      clearTestLogs(nydus)
      await expectRefusal(
        service.launch({ client, mapId: UMS_MAP.id }),
        SoloGameServiceErrorCode.NoActiveClient,
      )
      expectNothingChanged()
    })

    test('a user who is already in a gameplay activity', async () => {
      activityRegistry.registerActiveClient(USER.id, client, FriendActivityStatus.InLobby)
      clearTestLogs(nydus)

      await expectRefusal(
        service.launch({ client, mapId: UMS_MAP.id }),
        SoloGameServiceErrorCode.AlreadyInActivity,
      )

      expect(gameLoader.loadGame).not.toHaveBeenCalled()
      expect(isSubscribed()).toBe(false)
      expect(statusPublishes()).toEqual([])
      expect(activityStatusService.getStatus(USER.id)).toBe(FriendActivityStatus.InLobby)
    })

    test('a user who is already playing a game', async () => {
      activityStatusService.setInGame(USER.id, 'other-game', client)
      clearTestLogs(nydus)

      await expectRefusal(
        service.launch({ client, mapId: UMS_MAP.id }),
        SoloGameServiceErrorCode.AlreadyInGame,
      )
      expectNothingChanged()
      expect(activityStatusService.getStatus(USER.id)).toBe(FriendActivityStatus.InGame)
    })

    test('a second launch while the first is loading', async () => {
      await service.launch({ client, mapId: UMS_MAP.id })

      await expectRefusal(
        service.launch({ client, mapId: UMS_MAP.id }),
        SoloGameServiceErrorCode.AlreadyInActivity,
      )
      expect(loadRequests).toHaveLength(1)
      expect(activityRegistry.getClientForUser(USER.id)).toBe(client)
    })
  })

  describe('when the client disconnects mid-load', () => {
    test('carries on with the load', async () => {
      await service.launch({ client, mapId: UMS_MAP.id })

      socket.disconnect()
      await flushAsync()

      expect(gameLoader.cancelLoadingWithoutBlame).not.toHaveBeenCalled()
      expect(activityRegistry.getClientForUser(USER.id)).toBe(client)
    })

    test('lets go of the activity once the game starts anyway', async () => {
      await service.launch({ client, mapId: UMS_MAP.id })
      socket.disconnect()
      const reconnectedSocket = connector.connectClient(USER, 'APP_CLIENT')
      const reconnected = clientSockets.getById(USER.id, 'APP_CLIENT')!
      expect(reconnected).not.toBe(client)

      loadResult.resolve(Result.ok({ gameId: GAME_ID }))
      await flushAsync()

      expect(logger.error).not.toHaveBeenCalled()
      expect(activityRegistry.getClientForUser(USER.id)).toBeUndefined()
      expect(client.subscriptions.has(getSoloGamesPath(USER.id))).toBe(false)
      expect(asMockedFunction(reconnectedSocket.publish)).not.toHaveBeenCalledWith(
        getSoloGamesPath(USER.id),
        expect.anything(),
      )

      // The client that came back isn't left holding a launch it never made
      loadResult = createDeferred()
      await service.launch({ client: reconnected, mapId: UMS_MAP.id })
      expect(activityRegistry.getClientForUser(USER.id)).toBe(reconnected)
    })

    test('lets go of the activity when the load times out', async () => {
      await service.launch({ client, mapId: UMS_MAP.id })
      socket.disconnect()

      loadResult.resolve(
        Result.error(
          new BaseGameLoaderError(GameLoadErrorType.Timeout, 'timed out', {
            data: { unloaded: [USER.id] },
          }) as GameLoaderError,
        ),
      )
      await flushAsync()

      expect(logger.error).not.toHaveBeenCalled()
      expect(gameLoader.cancelLoadingWithoutBlame).not.toHaveBeenCalled()
      expect(activityRegistry.getClientForUser(USER.id)).toBeUndefined()
    })
  })
})
