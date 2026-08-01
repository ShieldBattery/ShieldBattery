import { Map as IMap } from 'immutable'
import { NydusServer } from 'nydus'
import { container } from 'tsyringe'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { GameType } from '../../../common/games/game-type'
import { LobbySummaryJson } from '../../../common/lobbies/lobby-network'
import { makeSbMapId, MapInfo, MapVisibility, Tileset } from '../../../common/maps'
import { asMockedFunction } from '../../../common/testing/mocks'
import { SbUser } from '../../../common/users/sb-user'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { GameServerRegionsService } from '../game-server-regions/game-server-regions-service'
import { GameLifecycleEvents } from '../games/game-lifecycle-events'
import { GameLoader } from '../games/game-loader'
import { GameplayActivityRegistry } from '../games/gameplay-activity-registry'
import { getMapInfos } from '../maps/map-models'
import { reparseMapsAsNeeded } from '../maps/map-operations'
import { NetcodeV2Service } from '../netcode-v2/netcode-v2-service'
import { RestrictionService } from '../users/restriction-service'
import { findUsersById } from '../users/user-model'
import { RequestSessionLookup } from '../websockets/session-lookup'
import { ClientSocketsManager, UserSocketsManager } from '../websockets/socket-groups'
import {
  clearTestLogs,
  createFakeNydusServer,
  FakeNydusServer,
  InspectableNydusClient,
  NydusConnector,
} from '../websockets/testing/websockets'
import { TypedPublisher } from '../websockets/typed-publisher'
import { LobbyService } from './lobby-service'
import { LobbyListApi } from './lobby-socket-api'

const BIG_GAME_HUNTERS: MapInfo = {
  id: makeSbMapId('big-game-hunters'),
  hash: 'deadbeef',
  name: 'Big Game Hunters',
  description: '',
  uploadedBy: makeSbUserId(1),
  uploadDate: new Date(0),
  visibility: MapVisibility.Official,
  mapData: {
    format: 'scm',
    tileset: Tileset.Jungle,
    originalName: 'Big Game Hunters',
    originalDescription: '',
    slots: 8,
    umsSlots: 8,
    umsForces: [{ name: 'team', teamId: 0, players: [] }],
    width: 256,
    height: 256,
    isEud: false,
    parserVersion: 1,
  },
  imageVersion: 1,
}

vi.mock('../maps/map-models', async () => {
  const actual = await vi.importActual<typeof import('../maps/map-models')>('../maps/map-models')
  return { ...actual, getMapInfos: vi.fn() }
})
vi.mock('../maps/map-operations', async () => {
  const actual =
    await vi.importActual<typeof import('../maps/map-operations')>('../maps/map-operations')
  return { ...actual, reparseMapsAsNeeded: vi.fn() }
})
vi.mock('../users/user-model', async () => {
  const actual = await vi.importActual<typeof import('../users/user-model')>('../users/user-model')
  return { ...actual, findUsersById: vi.fn() }
})

const HOST_USER: SbUser = { id: makeSbUserId(1), name: 'HostUser' } as SbUser
const OTHER_HOST_USER: SbUser = { id: makeSbUserId(3), name: 'OtherHostUser' } as SbUser
const LISTER_USER: SbUser = { id: makeSbUserId(4), name: 'ListerUser' } as SbUser

const NOOP_NEXT = async () => {}

describe('lobbies/lobby-socket-api', () => {
  let nydus: NydusServer
  let fakeNydus: FakeNydusServer
  let lobbyService: LobbyService
  let lobbyListApi: LobbyListApi
  let connector: NydusConnector
  let clientSockets: ClientSocketsManager
  let userSockets: UserSocketsManager

  let lister: InspectableNydusClient

  function apiData(client: InspectableNydusClient) {
    return IMap<string, any>({ client })
  }

  /** Creates a lobby hosted by `user`, whose single connected client is `clientId`. */
  async function createLobby(user: SbUser, clientId: string, name: string, visibility: string) {
    return await lobbyService.createLobby({
      name,
      map: BIG_GAME_HUNTERS.id,
      gameType: GameType.Melee,
      visibility: visibility as any,
      user: userSockets.getById(user.id)!,
      client: clientSockets.getById(user.id, clientId)!,
    })
  }

  beforeEach(() => {
    nydus = createFakeNydusServer()
    fakeNydus = nydus as unknown as FakeNydusServer
    const sessionLookup = new RequestSessionLookup()
    clientSockets = new ClientSocketsManager(nydus, sessionLookup)
    userSockets = new UserSocketsManager(nydus, sessionLookup, async () => {})

    lobbyService = new LobbyService(
      new TypedPublisher(nydus),
      new GameplayActivityRegistry(),
      { loadGame: vi.fn() } as unknown as GameLoader,
      { isRestricted: async () => false } as unknown as RestrictionService,
      { getRegions: async () => [] } as unknown as GameServerRegionsService,
      { warmRegions: () => {} } as unknown as NetcodeV2Service,
      userSockets,
      new GameLifecycleEvents(),
    )
    // The API resolves its service from the container, so the instance under test has to be
    // registered before it's constructed.
    container.registerInstance(LobbyService, lobbyService)

    lobbyListApi = new LobbyListApi(nydus, userSockets, clientSockets)
    connector = new NydusConnector(nydus, sessionLookup)

    asMockedFunction(getMapInfos).mockResolvedValue([BIG_GAME_HUNTERS])
    asMockedFunction(reparseMapsAsNeeded).mockResolvedValue([BIG_GAME_HUNTERS])
    asMockedFunction(findUsersById).mockResolvedValue([])

    connector.connectClient(HOST_USER, 'HOST_CLIENT')
    connector.connectClient(OTHER_HOST_USER, 'OTHER_HOST_CLIENT')
    lister = connector.connectClient(LISTER_USER, 'LISTER_CLIENT')

    clearTestLogs(nydus)
  })

  test("a new subscriber's initial snapshot omits unlisted lobbies", async () => {
    await createLobby(HOST_USER, 'HOST_CLIENT', 'Unlisted lobby', 'unlisted')
    await createLobby(OTHER_HOST_USER, 'OTHER_HOST_CLIENT', 'Listed lobby', 'listed')

    await lobbyListApi.subscribe(apiData(lister), NOOP_NEXT)

    const subscribeCall = fakeNydus.subscribeClient.mock.calls.find(
      ([, path]) => path === '/lobbies',
    )
    const initialData = subscribeCall![2] as {
      action: string
      payload: Iterable<LobbySummaryJson>
    }
    expect(initialData.action).toBe('full')
    expect(Array.from(initialData.payload).map(l => l.name)).toEqual(['Listed lobby'])
  })

  test('subscribing twice only subscribes the socket once, and takes two unsubscribes to undo', async () => {
    await lobbyListApi.subscribe(apiData(lister), NOOP_NEXT)
    await lobbyListApi.subscribe(apiData(lister), NOOP_NEXT)

    expect(
      fakeNydus.subscribeClient.mock.calls.filter(([, path]) => path === '/lobbies'),
    ).toHaveLength(1)

    await lobbyListApi.unsubscribe(apiData(lister), NOOP_NEXT)
    expect(fakeNydus.unsubscribeClient).not.toHaveBeenCalled()

    await lobbyListApi.unsubscribe(apiData(lister), NOOP_NEXT)
    expect(fakeNydus.unsubscribeClient).toHaveBeenCalledWith(lister, '/lobbies')
  })

  test('unsubscribing without a subscription is a conflict', async () => {
    await expect(lobbyListApi.unsubscribe(apiData(lister), NOOP_NEXT)).rejects.toMatchObject({
      status: 409,
    })
  })
})
