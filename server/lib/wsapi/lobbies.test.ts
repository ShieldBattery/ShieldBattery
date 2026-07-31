import { Map as IMap } from 'immutable'
import { NydusServer } from 'nydus'
import { container } from 'tsyringe'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { GameServerRegion, makeGameServerRegionId } from '../../../common/game-server-regions'
import { GameType } from '../../../common/games/game-type'
import { findSlotByUserId } from '../../../common/lobbies'
import {
  LobbyCreateErrorCode,
  LobbyJoinErrorCode,
  LobbySummaryJson,
} from '../../../common/lobbies/lobby-network'
import { makeSbLobbyId } from '../../../common/lobbies/sb-lobby-id'
import { makeSbMapId, MapInfo, MapVisibility, Tileset } from '../../../common/maps'
import { asMockedFunction } from '../../../common/testing/mocks'
import { SbUser } from '../../../common/users/sb-user'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { GameServerRegionsService } from '../game-server-regions/game-server-regions-service'
import { GameLoader } from '../games/game-loader'
import { GameplayActivityRegistry } from '../games/gameplay-activity-registry'
import { getLobbySummary } from '../lobbies/lobby-summaries'
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
import { knownRegionOrUndefined, LobbyApi } from './lobbies'

function region(id: string): GameServerRegion {
  return {
    id: makeGameServerRegionId(id),
    displayName: id,
    beacon: 'beacon:1',
    fallback: 'fallback:1',
  }
}

describe('wsapi/lobbies/knownRegionOrUndefined', () => {
  const regions = [region('us-east'), region('eu-west')]

  test('keeps a region that is still in the live list', () => {
    expect(knownRegionOrUndefined(makeGameServerRegionId('us-east'), regions)).toBe(
      makeGameServerRegionId('us-east'),
    )
  })

  test('drops a region the server no longer knows', () => {
    // The region list can change between the client fetching it and joining, so an unknown region
    // must degrade to region-less rather than being trusted.
    expect(knownRegionOrUndefined(makeGameServerRegionId('atlantis'), regions)).toBeUndefined()
  })

  test('resolves to undefined when the client reported no region', () => {
    expect(knownRegionOrUndefined(undefined, regions)).toBeUndefined()
  })

  test('drops any region when the live list is empty', () => {
    expect(knownRegionOrUndefined(makeGameServerRegionId('us-east'), [])).toBeUndefined()
  })
})

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
const JOINER_USER: SbUser = { id: makeSbUserId(2), name: 'JoinerUser' } as SbUser
const OTHER_HOST_USER: SbUser = { id: makeSbUserId(3), name: 'OtherHostUser' } as SbUser
const LISTER_USER: SbUser = { id: makeSbUserId(4), name: 'ListerUser' } as SbUser

const NOOP_NEXT = async () => {}

describe('wsapi/lobbies', () => {
  let nydus: NydusServer
  let fakeNydus: FakeNydusServer
  let lobbyApi: LobbyApi
  let connector: NydusConnector

  let host: InspectableNydusClient
  let joiner: InspectableNydusClient
  let otherHost: InspectableNydusClient
  let lister: InspectableNydusClient

  function apiData(client: InspectableNydusClient, body: Record<string, any> = {}) {
    return IMap<string, any>({ client, body })
  }

  /** Returns the data published on the public lobby list channel, in order. */
  function listPublishes(): Array<{ action: string; payload: any }> {
    return fakeNydus.publish.mock.calls
      .filter(([path]) => path === '/lobbies')
      .map(([, data]) => data)
  }

  /** Returns the most recently published open-lobby count, or undefined if none was published. */
  function latestLobbiesCount(): number | undefined {
    const counts = fakeNydus.publish.mock.calls.filter(([path]) => path === '/lobbiesCount')
    return counts.length ? counts[counts.length - 1][1].count : undefined
  }

  async function createLobby(
    client: InspectableNydusClient,
    name: string,
    visibility?: 'listed' | 'unlisted',
  ) {
    return (await lobbyApi.create(
      apiData(client, {
        name,
        map: BIG_GAME_HUNTERS.id,
        gameType: GameType.Melee,
        visibility,
      }),
      NOOP_NEXT,
    )) as { id: string }
  }

  beforeEach(() => {
    container.registerInstance(GameplayActivityRegistry, new GameplayActivityRegistry())
    container.registerInstance(GameLoader, {} as unknown as GameLoader)
    container.registerInstance(RestrictionService, {
      isRestricted: async () => false,
    } as unknown as RestrictionService)
    container.registerInstance(GameServerRegionsService, {
      getRegions: async () => [],
    } as unknown as GameServerRegionsService)
    container.registerInstance(NetcodeV2Service, {
      warmRegions: () => {},
    } as unknown as NetcodeV2Service)

    nydus = createFakeNydusServer()
    fakeNydus = nydus as unknown as FakeNydusServer
    const sessionLookup = new RequestSessionLookup()
    const clientSockets = new ClientSocketsManager(nydus, sessionLookup)
    const userSockets = new UserSocketsManager(nydus, sessionLookup, async () => {})
    lobbyApi = new LobbyApi(nydus, userSockets, clientSockets)
    connector = new NydusConnector(nydus, sessionLookup)

    asMockedFunction(getMapInfos).mockResolvedValue([BIG_GAME_HUNTERS])
    asMockedFunction(reparseMapsAsNeeded).mockResolvedValue([BIG_GAME_HUNTERS])
    asMockedFunction(findUsersById).mockResolvedValue([])

    host = connector.connectClient(HOST_USER, 'HOST_CLIENT')
    joiner = connector.connectClient(JOINER_USER, 'JOINER_CLIENT')
    otherHost = connector.connectClient(OTHER_HOST_USER, 'OTHER_HOST_CLIENT')
    lister = connector.connectClient(LISTER_USER, 'LISTER_CLIENT')

    clearTestLogs(nydus)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('visibility', () => {
    test('creating a listed lobby publishes it to the list and counts it', async () => {
      await createLobby(host, 'Listed lobby', 'listed')

      expect(listPublishes()).toEqual([
        { action: 'add', payload: expect.objectContaining({ name: 'Listed lobby' }) },
      ])
      expect(latestLobbiesCount()).toBe(1)
    })

    test('creating an unlisted lobby publishes nothing to the list and is not counted', async () => {
      await createLobby(host, 'Unlisted lobby', 'unlisted')

      expect(listPublishes()).toEqual([])
      expect(latestLobbiesCount()).toBe(0)
    })

    test("a new subscriber's initial snapshot omits unlisted lobbies", async () => {
      await createLobby(host, 'Unlisted lobby', 'unlisted')
      await createLobby(otherHost, 'Listed lobby', 'listed')

      await lobbyApi.subscribe(apiData(lister), NOOP_NEXT)

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

    test('closing an unlisted lobby does not publish its id to the list', async () => {
      await createLobby(host, 'Unlisted lobby', 'unlisted')
      fakeNydus.publish.mockClear()

      // The host is the only occupant, so leaving deletes the lobby.
      await lobbyApi.leave(apiData(host), NOOP_NEXT)

      expect(listPublishes()).toEqual([])
    })

    test('closing a listed lobby publishes its id to the list', async () => {
      const { id } = await createLobby(host, 'Listed lobby', 'listed')
      fakeNydus.publish.mockClear()

      await lobbyApi.leave(apiData(host), NOOP_NEXT)

      expect(listPublishes()).toEqual([{ action: 'delete', payload: id }])
    })

    test('starting the countdown in an unlisted lobby does not publish its id to the list', async () => {
      const { id } = await createLobby(host, 'Unlisted lobby', 'unlisted')
      await lobbyApi.join(apiData(joiner, { id }), NOOP_NEXT)
      fakeNydus.publish.mockClear()

      // Keeps the countdown from ever elapsing, so the test doesn't leave a game load in flight. The
      // handler publishes everything we care about before it suspends on the timer.
      vi.useFakeTimers()
      lobbyApi.startCountdown(apiData(host), NOOP_NEXT).catch(() => {})

      // The occupants still see the countdown; only the public list is kept in the dark.
      expect(
        fakeNydus.publish.mock.calls.some(
          ([path, data]) => path === `/lobbies/${id}` && data?.type === 'startCountdown',
        ),
      ).toBe(true)
      expect(listPublishes()).toEqual([])
    })

    test('joining an unlisted lobby does not publish an update to the list', async () => {
      const { id } = await createLobby(host, 'Unlisted lobby', 'unlisted')
      fakeNydus.publish.mockClear()

      await lobbyApi.join(apiData(joiner, { id }), NOOP_NEXT)

      // The occupants still see the new player; only the public list is kept in the dark.
      expect(
        fakeNydus.publish.mock.calls.some(
          ([path, data]) => path === `/lobbies/${id}` && data?.type === 'diff',
        ),
      ).toBe(true)
      expect(listPublishes()).toEqual([])
    })

    test('joining a listed lobby publishes an update to the list', async () => {
      const { id } = await createLobby(host, 'Listed lobby', 'listed')
      fakeNydus.publish.mockClear()

      await lobbyApi.join(apiData(joiner, { id }), NOOP_NEXT)

      expect(listPublishes()).toEqual([
        { action: 'update', payload: expect.objectContaining({ name: 'Listed lobby' }) },
      ])
    })

    test('creating a listed lobby with a name matching an existing listed lobby fails', async () => {
      await createLobby(host, 'Duplicate name', 'listed')

      await expect(createLobby(otherHost, 'Duplicate name', 'listed')).rejects.toMatchObject({
        body: { code: LobbyCreateErrorCode.NameTaken },
      })
    })

    test('creating a listed lobby with a name matching an existing unlisted lobby succeeds', async () => {
      await createLobby(host, 'Duplicate name', 'unlisted')

      await expect(createLobby(otherHost, 'Duplicate name', 'listed')).resolves.toBeDefined()
    })

    test('creating an unlisted lobby with a name matching an existing listed lobby succeeds', async () => {
      await createLobby(host, 'Duplicate name', 'listed')

      await expect(createLobby(otherHost, 'Duplicate name', 'unlisted')).resolves.toBeDefined()
    })
  })

  describe('join', () => {
    test('joining an unknown lobby id rejects with a noLongerOpen code', async () => {
      await expect(
        lobbyApi.join(apiData(joiner, { id: makeSbLobbyId('nonexistent-lobby') }), NOOP_NEXT),
      ).rejects.toMatchObject({
        body: { code: LobbyJoinErrorCode.NoLongerOpen },
      })
    })

    test('joining a full lobby rejects with a full code', async () => {
      const { id } = await lobbyApi.create(
        apiData(host, {
          name: 'Full lobby',
          map: BIG_GAME_HUNTERS.id,
          gameType: GameType.OneVsOne,
          visibility: 'listed',
        }),
        NOOP_NEXT,
      )
      // 1v1 lobbies only have 2 slots, and the host already occupies one.
      await lobbyApi.join(apiData(joiner, { id }), NOOP_NEXT)

      await expect(lobbyApi.join(apiData(otherHost, { id }), NOOP_NEXT)).rejects.toMatchObject({
        body: { code: LobbyJoinErrorCode.Full },
      })
    })

    test('joining while already in a gameplay activity rejects with an alreadyInActivity code', async () => {
      const { id } = await createLobby(otherHost, 'Other lobby', 'listed')

      // Hosting a lobby registers the host as being in a gameplay activity.
      await createLobby(host, 'Own lobby', 'listed')

      await expect(lobbyApi.join(apiData(host, { id }), NOOP_NEXT)).rejects.toMatchObject({
        body: { code: LobbyJoinErrorCode.AlreadyInActivity },
      })
    })

    test('joining a lobby during its countdown rejects with an alreadyStarted code', async () => {
      const { id } = await createLobby(host, 'Listed lobby', 'listed')
      // A countdown requires 2 opposing sides.
      await lobbyApi.join(apiData(joiner, { id }), NOOP_NEXT)

      // Keeps the countdown from ever elapsing, so the test doesn't leave a game load in flight.
      vi.useFakeTimers()
      lobbyApi.startCountdown(apiData(host), NOOP_NEXT).catch(() => {})

      // The client renders a counting-down/loading lobby as a whole separate screen, distinct from
      // the ordinary join-error codes covered above.
      await expect(lobbyApi.join(apiData(otherHost, { id }), NOOP_NEXT)).rejects.toMatchObject({
        body: { code: LobbyJoinErrorCode.AlreadyStarted },
      })
    })

    test('joining a lobby the user was banned from rejects with a banned code', async () => {
      const { id } = await createLobby(host, 'Listed lobby', 'listed')
      await lobbyApi.join(apiData(joiner, { id }), NOOP_NEXT)

      const lobby = lobbyApi.lobbies.get(makeSbLobbyId(id))!
      const [, , joinerSlot] = findSlotByUserId(lobby, JOINER_USER.id)
      await lobbyApi.banPlayer(apiData(host, { slotId: joinerSlot!.id }), NOOP_NEXT)

      await expect(lobbyApi.join(apiData(joiner, { id }), NOOP_NEXT)).rejects.toMatchObject({
        body: { code: LobbyJoinErrorCode.Banned },
      })
    })
  })

  describe('summaries', () => {
    test('a counting-down lobby is reported as gone by the summary getter', async () => {
      const { id } = await createLobby(host, 'Listed lobby', 'listed')
      await lobbyApi.join(apiData(joiner, { id }), NOOP_NEXT)

      // It can no longer be joined, so the unauthenticated summary endpoint and page-metadata
      // resolver must treat it the same as a lobby that doesn't exist at all.
      vi.useFakeTimers()
      lobbyApi.startCountdown(apiData(host), NOOP_NEXT).catch(() => {})

      expect(getLobbySummary(makeSbLobbyId(id))).toBeUndefined()
    })
  })
})
