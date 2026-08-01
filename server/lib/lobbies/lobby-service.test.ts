import { NydusServer } from 'nydus'
import { Result } from 'typescript-result'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { GameServerRegion, makeGameServerRegionId } from '../../../common/game-server-regions'
import { GameType } from '../../../common/games/game-type'
import {
  findSlotByUserId,
  getObserverTeam,
  LobbyVisibility,
  MAX_BENCH,
  openSlotCount,
} from '../../../common/lobbies'
import { SbLobbyId } from '../../../common/lobbies/sb-lobby-id'
import { makeSbMapId, MapInfo, MapVisibility, Tileset } from '../../../common/maps'
import { asMockedFunction } from '../../../common/testing/mocks'
import { SbUser } from '../../../common/users/sb-user'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { GameServerRegionsService } from '../game-server-regions/game-server-regions-service'
import { GameLifecycleEvents } from '../games/game-lifecycle-events'
import { GameLoader, GameLoadRequest } from '../games/game-loader'
import { GameplayActivityRegistry } from '../games/gameplay-activity-registry'
import { getMapInfos } from '../maps/map-models'
import { reparseMapsAsNeeded } from '../maps/map-operations'
import { NetcodeV2Service } from '../netcode-v2/netcode-v2-service'
import { RestrictionService } from '../users/restriction-service'
import { findUsersById } from '../users/user-model'
import { RequestSessionLookup } from '../websockets/session-lookup'
import {
  ClientSocketsGroup,
  ClientSocketsManager,
  UserSocketsGroup,
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
import { openSlot, removePlayer } from './lobby'
import { knownRegionOrUndefined, LobbyService, LobbyServiceErrorCode } from './lobby-service'
import { getLobbySummary } from './lobby-summaries'

function region(id: string): GameServerRegion {
  return {
    id: makeGameServerRegionId(id),
    displayName: id,
    beacon: 'beacon:1',
    fallback: 'fallback:1',
  }
}

describe('lobbies/lobby-service/knownRegionOrUndefined', () => {
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

/** A map small enough that changing to it leaves an 8-slot lobby with players to reconcile. */
const TWO_SLOT_MAP: MapInfo = {
  ...BIG_GAME_HUNTERS,
  id: makeSbMapId('heartbreak-ridge'),
  hash: '43ab7',
  name: 'Heartbreak Ridge',
  mapData: { ...BIG_GAME_HUNTERS.mapData, originalName: 'Heartbreak Ridge', slots: 2, umsSlots: 2 },
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

/** The socket groups a single connected client of a user is identified by. */
interface Sockets {
  user: UserSocketsGroup
  client: ClientSocketsGroup
  /** The one socket behind the groups above, so a test can drop the connection. */
  socket: InspectableNydusClient
}

describe('lobbies/lobby-service', () => {
  let nydus: NydusServer
  let fakeNydus: FakeNydusServer
  let lobbyService: LobbyService

  let host: Sockets
  let joiner: Sockets
  let otherHost: Sockets
  let lister: Sockets
  /** Connects a client for a user that isn't one of the four the tests share. */
  let connectExtra: (id: number) => Sockets
  /** Connects another client session for a user that already has one. */
  let connectSecondClient: (user: SbUser) => Sockets

  /** Connects a further client (another tab/machine of `user`) and returns its socket groups. */
  let connect: (user: SbUser, clientId: string) => Sockets

  /** Every request the stubbed `GameLoader` received via `loadGame`, in call order. */
  let loadGameRequests: GameLoadRequest[]
  /** The real emitter the service listens on, so tests can signal game ends into it. */
  let gameLifecycleEvents: GameLifecycleEvents
  /** The registry the service holds gameplay activity in, so tests can check who is in one. */
  let activityRegistry: GameplayActivityRegistry

  /** The stubbed `GameLoader.loadGame`, for tests that need to control when/how a load finishes. */
  let loadGameMock: ReturnType<typeof vi.fn<(request: GameLoadRequest) => Promise<unknown>>>

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
    sockets: Sockets,
    name: string,
    visibility?: LobbyVisibility,
    allowObservers?: boolean,
    gameType = GameType.Melee,
  ) {
    return await lobbyService.createLobby({
      name,
      map: BIG_GAME_HUNTERS.id,
      gameType,
      visibility,
      allowObservers,
      user: sockets.user,
      client: sockets.client,
    })
  }

  function joinLobby(sockets: Sockets, id: SbLobbyId, region?: string) {
    return lobbyService.joinLobby({
      id,
      region: region !== undefined ? makeGameServerRegionId(region) : undefined,
      user: sockets.user,
      client: sockets.client,
    })
  }

  /** Returns everything published on a lobby's own channel, in order. */
  function lobbyPublishes(id: SbLobbyId): any[] {
    return fakeNydus.publish.mock.calls
      .filter(([path]) => path === `/lobbies/${id}`)
      .map(([, data]) => data)
  }

  /** Returns every diff event published on a lobby's channel, flattened into one list. */
  function diffEvents(id: SbLobbyId): any[] {
    return lobbyPublishes(id)
      .filter(data => data?.type === 'diff')
      .flatMap(data => data.diffEvents)
  }

  /** Runs the countdown started by `startCountdown` to completion, letting the game load begin. */
  async function runCountdown(sockets: Sockets) {
    vi.useFakeTimers()
    lobbyService.startCountdown({ client: sockets.client })
    await vi.advanceTimersByTimeAsync(5000)
  }

  /** Signals that one member's game is over, the way the games code does when a report lands. */
  function endGameFor(sockets: Sockets, gameId = 'test-game-id') {
    gameLifecycleEvents.emit('userGameEnded', { gameId, userId: sockets.user.userId })
  }

  beforeEach(() => {
    nydus = createFakeNydusServer()
    fakeNydus = nydus as unknown as FakeNydusServer
    const sessionLookup = new RequestSessionLookup()
    const clientSockets = new ClientSocketsManager(nydus, sessionLookup)
    const userSockets = new UserSocketsManager(nydus, sessionLookup, async () => {})

    loadGameRequests = []
    loadGameMock = vi.fn<(request: GameLoadRequest) => Promise<unknown>>(async request => {
      loadGameRequests.push(request)
      return Result.ok({ gameId: 'test-game-id' })
    })
    gameLifecycleEvents = new GameLifecycleEvents()
    activityRegistry = new GameplayActivityRegistry()
    lobbyService = new LobbyService(
      new TypedPublisher(nydus),
      activityRegistry,
      {
        loadGame: loadGameMock,
      } as unknown as GameLoader,
      {
        isRestricted: async () => false,
      } as unknown as RestrictionService,
      {
        getRegions: async () => [region('us-east')],
      } as unknown as GameServerRegionsService,
      {
        warmRegions: () => {},
      } as unknown as NetcodeV2Service,
      userSockets,
      gameLifecycleEvents,
    )

    asMockedFunction(getMapInfos).mockResolvedValue([BIG_GAME_HUNTERS])
    asMockedFunction(reparseMapsAsNeeded).mockResolvedValue([BIG_GAME_HUNTERS])
    asMockedFunction(findUsersById).mockResolvedValue([])

    const connector = new NydusConnector(nydus, sessionLookup)
    connect = (user: SbUser, clientId: string): Sockets => {
      const socket = connector.connectClient(user, clientId)
      return {
        user: userSockets.getById(user.id)!,
        client: clientSockets.getById(user.id, clientId)!,
        socket,
      }
    }
    host = connect(HOST_USER, 'HOST_CLIENT')
    joiner = connect(JOINER_USER, 'JOINER_CLIENT')
    otherHost = connect(OTHER_HOST_USER, 'OTHER_HOST_CLIENT')
    lister = connect(LISTER_USER, 'LISTER_CLIENT')
    connectExtra = id =>
      connect({ id: makeSbUserId(id), name: `User${id}` } as SbUser, `CLIENT_${id}`)
    connectSecondClient = user => connect(user, `SECOND_CLIENT_${user.id}`)

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

    test('closing an unlisted lobby does not publish its id to the list', async () => {
      await createLobby(host, 'Unlisted lobby', 'unlisted')
      fakeNydus.publish.mockClear()

      // The host is the only occupant, so leaving deletes the lobby.
      lobbyService.leaveLobby({ client: host.client })

      expect(listPublishes()).toEqual([])
    })

    test('closing a listed lobby publishes its id to the list', async () => {
      const { id } = await createLobby(host, 'Listed lobby', 'listed')
      fakeNydus.publish.mockClear()

      lobbyService.leaveLobby({ client: host.client })

      expect(listPublishes()).toEqual([{ action: 'delete', payload: id }])
    })

    test('starting the countdown in an unlisted lobby does not publish its id to the list', async () => {
      const { id } = await createLobby(host, 'Unlisted lobby', 'unlisted')
      await joinLobby(joiner, id)
      fakeNydus.publish.mockClear()

      // Keeps the countdown from ever elapsing, so the test doesn't leave a game load in flight. The
      // service publishes everything we care about before it suspends on the timer.
      vi.useFakeTimers()
      lobbyService.startCountdown({ client: host.client })

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

      await joinLobby(joiner, id)

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

      await joinLobby(joiner, id)

      expect(listPublishes()).toEqual([
        { action: 'update', payload: expect.objectContaining({ name: 'Listed lobby' }) },
      ])
    })

    test('creating a listed lobby with a name matching an existing listed lobby fails', async () => {
      await createLobby(host, 'Duplicate name', 'listed')

      await expect(createLobby(otherHost, 'Duplicate name', 'listed')).rejects.toMatchObject({
        code: LobbyServiceErrorCode.NameTaken,
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

    test('the listed summaries omit unlisted lobbies', async () => {
      await createLobby(host, 'Unlisted lobby', 'unlisted')
      await createLobby(otherHost, 'Listed lobby', 'listed')

      expect(lobbyService.getListedSummaries().map(l => l.name)).toEqual(['Listed lobby'])
    })
  })

  describe('join', () => {
    test('joining an unknown lobby id rejects with a NoLobby code', async () => {
      await expect(joinLobby(joiner, 'nonexistent-lobby' as SbLobbyId)).rejects.toMatchObject({
        code: LobbyServiceErrorCode.NoLobby,
      })
    })

    test('a join does not clobber changes that land during its map refresh', async () => {
      const { id } = await createLobby(host, 'Listed lobby', 'listed')

      let resolveMapFetch: (value: MapInfo[]) => void
      asMockedFunction(getMapInfos).mockReturnValueOnce(
        new Promise(resolve => {
          resolveMapFetch = resolve
        }),
      )
      const callsBefore = asMockedFunction(getMapInfos).mock.calls.length
      const join = joinLobby(joiner, id)
      // Let the join run up to its pending map refresh, so the settings change lands mid-fetch
      await vi.waitFor(() => {
        expect(asMockedFunction(getMapInfos).mock.calls.length).toBeGreaterThan(callsBefore)
      })

      await lobbyService.updateSettings({ client: host.client, lobbyId: id, useLegacyLimits: true })

      resolveMapFetch!([BIG_GAME_HUNTERS])
      await join

      const lobby = lobbyService.lobbies.get(id)!
      expect(lobby.useLegacyLimits).toBe(true)
      expect(findSlotByUserId(lobby, JOINER_USER.id)[2]).toBeDefined()
    })

    test('joining a full lobby puts the joiner on the bench', async () => {
      const { id } = await createLobby(host, 'Full lobby', 'listed', undefined, GameType.OneVsOne)
      // 1v1 lobbies only have 2 slots, and the host already occupies one.
      await joinLobby(joiner, id)
      fakeNydus.publish.mockClear()

      await joinLobby(otherHost, id)

      expect(lobbyService.lobbies.get(id)!.bench).toEqual([
        { userId: OTHER_HOST_USER.id, race: 'r', joinedAt: expect.any(Number), region: undefined },
      ])
      expect(diffEvents(id)).toContainEqual({
        type: 'benchAdd',
        user: expect.objectContaining({ userId: OTHER_HOST_USER.id }),
      })
      // They are in the lobby like anyone else, and so can't be off in another activity
      expect(lobbyService.lobbyClients.get(otherHost.client)).toBe(id)
      expect(activityRegistry.getClientForUser(OTHER_HOST_USER.id)).toBe(otherHost.client)
    })

    test('joining a lobby whose bench is also full rejects with a LobbyFull code', async () => {
      const { id } = await createLobby(host, 'Full lobby', 'listed', undefined, GameType.OneVsOne)
      await joinLobby(joiner, id)
      for (let i = 0; i < MAX_BENCH; i++) {
        await joinLobby(connectExtra(100 + i), id)
      }
      expect(lobbyService.lobbies.get(id)!.bench).toHaveLength(MAX_BENCH)

      await expect(joinLobby(otherHost, id)).rejects.toMatchObject({
        code: LobbyServiceErrorCode.LobbyFull,
      })
    })

    test('joining while already in a gameplay activity rejects with a JoinAlreadyInActivity code', async () => {
      const { id } = await createLobby(otherHost, 'Other lobby', 'listed')

      // Hosting a lobby registers the host as being in a gameplay activity.
      await createLobby(host, 'Own lobby', 'listed')

      await expect(joinLobby(host, id)).rejects.toMatchObject({
        code: LobbyServiceErrorCode.JoinAlreadyInActivity,
      })
    })

    test('joining a lobby during its countdown rejects with a JoinAlreadyStarted code', async () => {
      const { id } = await createLobby(host, 'Listed lobby', 'listed')
      // A countdown requires 2 opposing sides.
      await joinLobby(joiner, id)

      // Keeps the countdown from ever elapsing, so the test doesn't leave a game load in flight.
      vi.useFakeTimers()
      lobbyService.startCountdown({ client: host.client })

      // The client renders a counting-down/loading lobby as a whole separate screen, distinct from
      // the ordinary join-error codes covered above.
      await expect(joinLobby(otherHost, id)).rejects.toMatchObject({
        code: LobbyServiceErrorCode.JoinAlreadyStarted,
      })
    })

    test('joining a lobby the user was banned from rejects with a Banned code', async () => {
      const { id } = await createLobby(host, 'Listed lobby', 'listed')
      await joinLobby(joiner, id)

      const lobby = lobbyService.lobbies.get(id)!
      const [, , joinerSlot] = findSlotByUserId(lobby, JOINER_USER.id)
      lobbyService.banPlayer({ client: host.client, slotId: joinerSlot!.id })

      await expect(joinLobby(joiner, id)).rejects.toMatchObject({
        code: LobbyServiceErrorCode.Banned,
      })
    })
  })

  describe('leave', () => {
    test('a leave from another client of the same user is rejected', async () => {
      const { id } = await createLobby(host, 'Listed lobby', 'listed')
      const secondClient = connectSecondClient(HOST_USER)

      // Membership is per client, so a client that is in no lobby has nothing to leave, even when
      // another client of the same user is in one.
      expect(() => lobbyService.leaveLobby({ client: secondClient.client, lobbyId: id })).toThrow(
        expect.objectContaining({ code: LobbyServiceErrorCode.NotInLobby }),
      )

      expect(lobbyService.lobbies.has(id)).toBe(true)
      expect(lobbyService.lobbyClients.get(host.client)).toBe(id)
    })

    test('the client the request names is the one that leaves', async () => {
      const { id } = await createLobby(host, 'Listed lobby', 'listed')
      await joinLobby(joiner, id)

      lobbyService.leaveLobby({ client: joiner.client, lobbyId: id })

      expect(lobbyService.lobbyClients.has(joiner.client)).toBe(false)
      expect(lobbyService.lobbyClients.get(host.client)).toBe(id)
      expect(findSlotByUserId(lobbyService.lobbies.get(id)!, JOINER_USER.id)[2]).toBeUndefined()
    })
  })

  describe('bench', () => {
    /** Creates a 1v1 lobby with both slots taken and `otherHost` waiting on the bench. */
    async function createLobbyWithBench(region?: string) {
      const { id } = await createLobby(host, 'Full lobby', 'listed', undefined, GameType.OneVsOne)
      await joinLobby(joiner, id)
      await joinLobby(otherHost, id, region)
      return id
    }

    test('a member leaving the bench leaves the lobby', async () => {
      const id = await createLobbyWithBench()
      fakeNydus.publish.mockClear()

      lobbyService.leaveLobby({ client: otherHost.client })

      expect(lobbyService.lobbies.get(id)!.bench).toHaveLength(0)
      expect(lobbyService.lobbyClients.has(otherHost.client)).toBe(false)
      expect(lobbyService.getLobbyState({ lobbyId: id }).lobbyState).toBe('exists')
      // Someone waiting for a seat holds no slot, so no leave/kick/ban is published for them: this
      // is the only event that tells their own client it is out of the lobby.
      expect(diffEvents(id)).toContainEqual({
        type: 'benchRemove',
        userId: OTHER_HOST_USER.id,
        reason: 'left',
      })
      expect(
        fakeNydus.publish.mock.calls.some(
          ([path, data]) => path === `/lobbies/${id}/${OTHER_HOST_USER.id}` && data?.lobby === null,
        ),
      ).toBe(true)
    })

    test('closing a computer slot that dissolves its team seats waiting members', async () => {
      const { id } = await lobbyService.createLobby({
        name: 'Team lobby',
        map: BIG_GAME_HUNTERS.id,
        gameType: GameType.TeamMelee,
        gameSubType: 2,
        visibility: 'listed',
        user: host.user,
        client: host.client,
      })
      let lobby = lobbyService.lobbies.get(id)!
      lobbyService.addComputer({ client: host.client, slotId: lobby.teams[1].slots[0].id })
      await joinLobby(joiner, id)
      await joinLobby(otherHost, id)
      await joinLobby(lister, id)

      // Both teams full, so the next join waits on the bench
      const extra = connectExtra(100)
      await joinLobby(extra, id)
      expect(lobbyService.lobbies.get(id)!.bench).toHaveLength(1)

      // Closing one computer slot removes the whole computer team, leaving the rest of its slots
      // open - open seats that must go to whoever was waiting
      lobby = lobbyService.lobbies.get(id)!
      lobbyService.closeSlot({ client: host.client, slotId: lobby.teams[1].slots[0].id })

      const updated = lobbyService.lobbies.get(id)!
      expect(updated.bench).toHaveLength(0)
      expect(findSlotByUserId(updated, makeSbUserId(100))[2]!.type).toBe('human')
    })

    test('a member leaving the bench does not cancel a countdown in progress', async () => {
      const id = await createLobbyWithBench()

      vi.useFakeTimers()
      lobbyService.startCountdown({ client: host.client })
      fakeNydus.publish.mockClear()

      // The benched member holds no slot in the starting game, so their leave changes nothing
      // about it
      lobbyService.leaveLobby({ client: otherHost.client })

      expect(lobbyService.lobbies.get(id)!.bench).toHaveLength(0)
      expect(lobbyPublishes(id).some(data => data?.type === 'cancelCountdown')).toBe(false)
    })

    test('a failed load still cancels after a bench member left during it', async () => {
      const id = await createLobbyWithBench()

      let failLoad: (err: Error) => void
      loadGameMock.mockImplementationOnce(async (request: GameLoadRequest) => {
        loadGameRequests.push(request)
        return await new Promise((_resolve, reject) => {
          failLoad = reject
        })
      })

      vi.useFakeTimers()
      lobbyService.startCountdown({ client: host.client })
      await vi.advanceTimersByTimeAsync(5000)
      vi.useRealTimers()
      expect(loadGameRequests).toHaveLength(1)

      // The stored lobby gets updated by this mid-load, and the load failure must still find it
      lobbyService.leaveLobby({ client: otherHost.client })
      fakeNydus.publish.mockClear()

      failLoad!(new Error('load exploded'))
      await vi.waitFor(() => {
        expect(lobbyPublishes(id).some(data => data?.type === 'cancelLoading')).toBe(true)
      })

      // The lobby is gathering again rather than wedged in its loading state
      expect(lobbyService.getLobbyState({ lobbyId: id }).lobbyState).toBe('exists')
    })

    test('a game start does not release a bench member who already left for another lobby', async () => {
      const id = await createLobbyWithBench()

      let finishLoad: () => void
      loadGameMock.mockImplementationOnce(async (request: GameLoadRequest) => {
        loadGameRequests.push(request)
        await new Promise<void>(resolve => {
          finishLoad = resolve
        })
        return Result.ok({ gameId: 'test-game-id' })
      })

      vi.useFakeTimers()
      lobbyService.startCountdown({ client: host.client })
      await vi.advanceTimersByTimeAsync(5000)
      vi.useRealTimers()

      // The bench member moves on to a lobby of their own while the first one is loading
      lobbyService.leaveLobby({ client: otherHost.client })
      const { id: otherId } = await lobbyService.createLobby({
        name: 'Moved on',
        map: BIG_GAME_HUNTERS.id,
        gameType: GameType.Melee,
        visibility: 'listed',
        user: otherHost.user,
        client: otherHost.client,
      })

      finishLoad!()
      await vi.waitFor(() => {
        expect(lobbyService.runStates.has(id)).toBe(true)
      })

      // The first lobby's start must not have released their registration in the new activity —
      // which would let this join go through instead of being rejected
      await expect(joinLobby(otherHost, otherId)).rejects.toMatchObject({
        code: LobbyServiceErrorCode.JoinAlreadyInActivity,
      })
    })

    test('a member kicked from the bench is reported as kicked', async () => {
      const id = await createLobbyWithBench()

      // Someone waiting for a seat has no slot, so the host names them by their user id
      lobbyService.kickPlayer({ client: host.client, slotId: String(OTHER_HOST_USER.id) })

      expect(lobbyService.lobbies.get(id)!.bench).toHaveLength(0)
      expect(diffEvents(id)).toContainEqual({
        type: 'benchRemove',
        userId: OTHER_HOST_USER.id,
        reason: 'kicked',
      })
    })

    test('a member banned from the bench cannot rejoin', async () => {
      const id = await createLobbyWithBench()
      fakeNydus.publish.mockClear()

      // Someone waiting for a seat has no slot, so the host names them by their user id
      lobbyService.banPlayer({ client: host.client, slotId: String(OTHER_HOST_USER.id) })

      expect(lobbyService.lobbies.get(id)!.bench).toHaveLength(0)
      expect(diffEvents(id)).toContainEqual({
        type: 'benchRemove',
        userId: OTHER_HOST_USER.id,
        reason: 'banned',
      })
      await expect(joinLobby(otherHost, id)).rejects.toMatchObject({
        code: LobbyServiceErrorCode.Banned,
      })
    })

    test('a seat that frees up goes to the member who has been waiting longest', async () => {
      const { id } = await createLobby(host, 'Full lobby', 'listed', undefined, GameType.OneVsOne)
      await joinLobby(joiner, id)
      await joinLobby(otherHost, id)
      await joinLobby(lister, id)
      expect(lobbyService.lobbies.get(id)!.bench.map(b => b.userId)).toEqual([
        OTHER_HOST_USER.id,
        LISTER_USER.id,
      ])

      const [, , joinerSlot] = findSlotByUserId(lobbyService.lobbies.get(id)!, JOINER_USER.id)
      lobbyService.kickPlayer({ client: host.client, slotId: joinerSlot!.id })

      const lobby = lobbyService.lobbies.get(id)!
      expect(findSlotByUserId(lobby, OTHER_HOST_USER.id)[2]).toBeDefined()
      expect(lobby.bench.map(b => b.userId)).toEqual([LISTER_USER.id])
      // An absent reason is what says they were seated rather than removed from the lobby; the
      // accompanying slot events describe the seat they got.
      expect(diffEvents(id)).toContainEqual({
        type: 'benchRemove',
        userId: OTHER_HOST_USER.id,
        reason: undefined,
      })
    })

    test('opening a slot seats a waiting member', async () => {
      const { id } = await createLobby(host, 'Full lobby', 'listed', undefined, GameType.OneVsOne)
      await joinLobby(joiner, id)
      const [, , joinerSlot] = findSlotByUserId(lobbyService.lobbies.get(id)!, JOINER_USER.id)
      // Closing the slot the joiner is in removes them without letting anyone else have it
      lobbyService.closeSlot({ client: host.client, slotId: joinerSlot!.id })
      await joinLobby(otherHost, id)
      expect(lobbyService.lobbies.get(id)!.bench).toHaveLength(1)

      const closedSlot = lobbyService.lobbies.get(id)!.teams[0].slots[1]
      expect(closedSlot.type).toBe('closed')
      lobbyService.openSlot({ client: host.client, slotId: closedSlot.id })

      const lobby = lobbyService.lobbies.get(id)!
      expect(lobby.bench).toHaveLength(0)
      expect(findSlotByUserId(lobby, OTHER_HOST_USER.id)[2]!.type).toBe('human')
    })

    test('a player seat vacated by a move to the observer team seats a waiting member', async () => {
      const { id } = await createLobby(host, 'Obs lobby', 'listed', true, GameType.OneVsOne)
      await joinLobby(joiner, id)
      await joinLobby(otherHost, id)
      expect(lobbyService.lobbies.get(id)!.bench.map(b => b.userId)).toEqual([OTHER_HOST_USER.id])

      // Open an observer slot directly, since every service operation that opens one would have
      // seated the waiting member itself already
      let lobby = lobbyService.lobbies.get(id)!
      const [obsTeamIndex] = getObserverTeam(lobby)
      lobbyService.lobbies.set(id, openSlot(lobby, obsTeamIndex!, 0))

      lobby = lobbyService.lobbies.get(id)!
      const [, , joinerSlot] = findSlotByUserId(lobby, JOINER_USER.id)
      lobbyService.moveSlot({
        client: host.client,
        lobbyId: id,
        fromSlotId: joinerSlot!.id,
        toSlotId: lobby.teams[obsTeamIndex!].slots[0].id,
      })

      const updated = lobbyService.lobbies.get(id)!
      expect(updated.bench).toHaveLength(0)
      expect(findSlotByUserId(updated, JOINER_USER.id)[2]!.type).toBe('observer')
      expect(findSlotByUserId(updated, OTHER_HOST_USER.id)[2]!.type).toBe('human')
    })

    test('a player seat vacated by a move onto a closed slot seats a waiting member', async () => {
      const { id } = await createLobby(host, 'Listed lobby', 'listed')
      await joinLobby(joiner, id)
      const lobby = lobbyService.lobbies.get(id)!
      const [joinerTeamIndex, joinerSlotIndex] = findSlotByUserId(lobby, JOINER_USER.id)
      // Close every slot beyond the two seated players, leaving no room for a further join
      for (const slotId of lobby.teams[0].slots.slice(2).map(s => s.id)) {
        lobbyService.closeSlot({ client: host.client, slotId })
      }
      await joinLobby(otherHost, id)
      expect(lobbyService.lobbies.get(id)!.bench.map(b => b.userId)).toEqual([OTHER_HOST_USER.id])

      const beforeMove = lobbyService.lobbies.get(id)!
      const closedSlot = beforeMove.teams[0].slots[2]
      lobbyService.moveSlot({
        client: host.client,
        lobbyId: id,
        fromSlotId: beforeMove.teams[joinerTeamIndex!].slots[joinerSlotIndex!].id,
        toSlotId: closedSlot.id,
      })

      const updated = lobbyService.lobbies.get(id)!
      expect(updated.bench).toHaveLength(0)
      expect(updated.teams[0].slots[2].userId).toBe(JOINER_USER.id)
      expect(updated.teams[joinerTeamIndex!].slots[joinerSlotIndex!].userId).toBe(
        OTHER_HOST_USER.id,
      )
    })

    test('an observer slot vacated by making its occupant a player seats a waiting member', async () => {
      const { id } = await createLobby(host, 'Obs lobby', 'listed', true, GameType.OneVsOne)
      await joinLobby(joiner, id)

      // The joiner observes, and the player seat they left behind is closed
      let lobby = lobbyService.lobbies.get(id)!
      const [, , joinerSlot] = findSlotByUserId(lobby, JOINER_USER.id)
      lobbyService.makeObserver({ client: host.client, slotId: joinerSlot!.id })
      lobby = lobbyService.lobbies.get(id)!
      const openSlot = lobby.teams[0].slots.find(slot => slot.type === 'open')!
      lobbyService.closeSlot({ client: host.client, slotId: openSlot.id })

      // With every slot occupied or closed, the next join waits on the bench
      await joinLobby(otherHost, id)
      expect(lobbyService.lobbies.get(id)!.bench.map(b => b.userId)).toEqual([OTHER_HOST_USER.id])

      // Making the observer a player sends them to the closed player slot, and the observer slot
      // they vacate goes to the member who was waiting
      lobby = lobbyService.lobbies.get(id)!
      const [, obsTeam] = getObserverTeam(lobby)
      const obsSlot = obsTeam!.slots.find(slot => slot.type === 'observer')!
      lobbyService.removeObserver({ client: host.client, slotId: obsSlot.id })

      const updated = lobbyService.lobbies.get(id)!
      expect(updated.bench).toHaveLength(0)
      expect(findSlotByUserId(updated, JOINER_USER.id)[2]!.type).toBe('human')
      expect(findSlotByUserId(updated, OTHER_HOST_USER.id)[2]!.type).toBe('observer')
    })

    test('the lobby is handed to a waiting member when its last player leaves', async () => {
      const id = await createLobbyWithBench()
      const listerSlot = findSlotByUserId(lobbyService.lobbies.get(id)!, JOINER_USER.id)[2]
      lobbyService.kickPlayer({ client: host.client, slotId: listerSlot!.id })
      // The kicked player's seat went to the member who was waiting for one
      expect(lobbyService.lobbies.get(id)!.bench).toHaveLength(0)

      lobbyService.leaveLobby({ client: host.client })

      const lobby = lobbyService.lobbies.get(id)!
      expect(lobby.host.userId).toBe(OTHER_HOST_USER.id)
    })

    test('a member taking a seat themselves keeps what they were waiting with', async () => {
      const id = await createLobbyWithBench('us-east')
      const benched = lobbyService.lobbies.get(id)!.bench[0]
      // Free a slot without seating anyone in it, which is a state the automatic seating of
      // waiting members otherwise doesn't leave the lobby in
      const lobby = lobbyService.lobbies.get(id)!
      const [teamIndex, slotIndex, joinerSlot] = findSlotByUserId(lobby, JOINER_USER.id)
      lobbyService.lobbies.set(id, removePlayer(lobby, teamIndex!, slotIndex!, joinerSlot!)!)
      const openSlotId = lobbyService.lobbies.get(id)!.teams[0].slots[slotIndex!].id

      lobbyService.changeSlot({ client: otherHost.client, slotId: openSlotId })

      const updated = lobbyService.lobbies.get(id)!
      expect(updated.bench).toHaveLength(0)
      const seated = findSlotByUserId(updated, OTHER_HOST_USER.id)[2]!
      expect(seated.type).toBe('human')
      expect(seated.region).toBe(makeGameServerRegionId('us-east'))
      expect(seated.joinedAt).toBe(benched.joinedAt)
    })

    test('a waiting member cannot act as the host', async () => {
      const id = await createLobbyWithBench()
      const openSlot = lobbyService.lobbies.get(id)!.teams[0].slots[0]

      expect(() =>
        lobbyService.kickPlayer({ client: otherHost.client, slotId: openSlot.id }),
      ).toThrow(expect.objectContaining({ code: LobbyServiceErrorCode.NotHost }))
    })
  })

  describe('updateSettings', () => {
    test('only the host can change the settings', async () => {
      const { id } = await createLobby(host, 'Listed lobby', 'listed')
      await joinLobby(joiner, id)

      await expect(
        lobbyService.updateSettings({ client: joiner.client, lobbyId: id, useLegacyLimits: true }),
      ).rejects.toMatchObject({ code: LobbyServiceErrorCode.NotHost })
    })

    test('the settings cannot be changed once the lobby is counting down', async () => {
      const { id } = await createLobby(host, 'Listed lobby', 'listed')
      await joinLobby(joiner, id)

      vi.useFakeTimers()
      lobbyService.startCountdown({ client: host.client })

      await expect(
        lobbyService.updateSettings({ client: host.client, lobbyId: id, useLegacyLimits: true }),
      ).rejects.toMatchObject({ code: LobbyServiceErrorCode.CountingDown })
    })

    test('a change publishes the new lobby along with what the host changed', async () => {
      const { id } = await createLobby(host, 'Listed lobby', 'listed')
      fakeNydus.publish.mockClear()

      await lobbyService.updateSettings({ client: host.client, lobbyId: id, useLegacyLimits: true })

      expect(lobbyService.lobbies.get(id)!.useLegacyLimits).toBe(true)
      expect(lobbyPublishes(id)).toEqual([
        {
          type: 'settingsChange',
          changedSettings: ['useLegacyLimits'],
          lobby: lobbyService.lobbies.get(id),
        },
      ])
      // The list shows the lobby's map and game type, so it has to be told about the change too
      expect(listPublishes()).toEqual([
        { action: 'update', payload: expect.objectContaining({ name: 'Listed lobby' }) },
      ])
    })

    test('a change to a smaller map benches the players it leaves over', async () => {
      const { id } = await createLobby(host, 'Listed lobby', 'listed')
      await joinLobby(joiner, id)
      await joinLobby(otherHost, id)
      asMockedFunction(getMapInfos).mockResolvedValue([TWO_SLOT_MAP])
      asMockedFunction(reparseMapsAsNeeded).mockResolvedValue([TWO_SLOT_MAP])
      fakeNydus.publish.mockClear()

      await lobbyService.updateSettings({ client: host.client, lobbyId: id, map: TWO_SLOT_MAP.id })

      const lobby = lobbyService.lobbies.get(id)!
      expect(lobby.map!.id).toBe(TWO_SLOT_MAP.id)
      expect(lobby.teams[0].slots).toHaveLength(2)
      expect(lobby.bench.map(b => b.userId)).toEqual([OTHER_HOST_USER.id])
      const published = lobbyPublishes(id)
      expect(published).toHaveLength(1)
      expect(published[0].type).toBe('settingsChange')
      expect(published[0].changedSettings).toEqual(['map'])
      expect(published[0].lobby.bench).toEqual(lobby.bench)
    })

    test('a change to a game type the map cannot support is rejected', async () => {
      const { id } = await createLobby(host, 'Listed lobby', 'listed')

      // Big Game Hunters has no UMS forces to take its settings from
      await expect(
        lobbyService.updateSettings({
          client: host.client,
          lobbyId: id,
          gameType: GameType.UseMapSettings,
        }),
      ).rejects.toMatchObject({ code: LobbyServiceErrorCode.InvalidGameType })
    })

    test('a change to a sub-type the game type cannot support is rejected', async () => {
      const { id } = await createLobby(host, 'Listed lobby', 'listed')

      await expect(
        lobbyService.updateSettings({
          client: host.client,
          lobbyId: id,
          gameType: GameType.TeamMelee,
          gameSubType: 7,
        }),
      ).rejects.toMatchObject({ code: LobbyServiceErrorCode.InvalidGameSubType })
    })

    test("a change to a sub-type beyond the new map's slots is rejected", async () => {
      const { id } = await createLobby(host, 'Listed lobby', 'listed')
      asMockedFunction(getMapInfos).mockResolvedValue([TWO_SLOT_MAP])
      asMockedFunction(reparseMapsAsNeeded).mockResolvedValue([TWO_SLOT_MAP])

      // The sub-type is validated against the map's own slot count (not team melee's fixed 8
      // total), the same way creating this lobby would be
      await expect(
        lobbyService.updateSettings({
          client: host.client,
          lobbyId: id,
          map: TWO_SLOT_MAP.id,
          gameType: GameType.TeamMelee,
          gameSubType: 3,
        }),
      ).rejects.toMatchObject({ code: LobbyServiceErrorCode.InvalidGameSubType })
    })

    test('a change that alters nothing is not applied or announced', async () => {
      const { id } = await createLobby(host, 'Listed lobby', 'listed')
      fakeNydus.publish.mockClear()

      await lobbyService.updateSettings({
        client: host.client,
        lobbyId: id,
        useLegacyLimits: false,
        allowObservers: false,
      })

      expect(lobbyPublishes(id)).toEqual([])
      expect(listPublishes()).toEqual([])
    })
  })

  describe('moveSlot', () => {
    test('the host can exchange two players in a lobby with no room to move', async () => {
      const { id } = await createLobby(host, 'Full lobby', 'listed', undefined, GameType.OneVsOne)
      await joinLobby(joiner, id)
      const lobby = lobbyService.lobbies.get(id)!
      const hostSlot = lobby.teams[0].slots[0]
      const joinerSlot = lobby.teams[0].slots[1]

      lobbyService.moveSlot({
        client: host.client,
        lobbyId: id,
        fromSlotId: hostSlot.id,
        toSlotId: joinerSlot.id,
      })

      const updated = lobbyService.lobbies.get(id)!
      expect(updated.teams[0].slots[0].userId).toBe(JOINER_USER.id)
      expect(updated.teams[0].slots[1].userId).toBe(HOST_USER.id)
      expect(updated.host.id).toBe(hostSlot.id)
    })

    test('the host can move a player into a free slot', async () => {
      const { id } = await createLobby(host, 'Listed lobby', 'listed')
      await joinLobby(joiner, id)
      const lobby = lobbyService.lobbies.get(id)!
      const [, , joinerSlot] = findSlotByUserId(lobby, JOINER_USER.id)

      lobbyService.moveSlot({
        client: host.client,
        lobbyId: id,
        fromSlotId: joinerSlot!.id,
        toSlotId: lobby.teams[0].slots[4].id,
      })

      const updated = lobbyService.lobbies.get(id)!
      expect(updated.teams[0].slots[4].userId).toBe(JOINER_USER.id)
      expect(updated.teams[0].slots[1].type).toBe('open')
    })

    test('the host can move a player onto a closed slot, opening it as part of the move', async () => {
      const { id } = await createLobby(host, 'Listed lobby', 'listed')
      await joinLobby(joiner, id)
      let lobby = lobbyService.lobbies.get(id)!
      const [, , joinerSlot] = findSlotByUserId(lobby, JOINER_USER.id)
      lobbyService.closeSlot({ client: host.client, slotId: lobby.teams[0].slots[4].id })
      lobby = lobbyService.lobbies.get(id)!
      const closedSlot = lobby.teams[0].slots[4]
      expect(closedSlot.type).toBe('closed')

      lobbyService.moveSlot({
        client: host.client,
        lobbyId: id,
        fromSlotId: joinerSlot!.id,
        toSlotId: closedSlot.id,
      })

      const updated = lobbyService.lobbies.get(id)!
      expect(updated.teams[0].slots[4].type).toBe('human')
      expect(updated.teams[0].slots[4].userId).toBe(JOINER_USER.id)
      expect(updated.teams[0].slots[1].type).toBe('open')
    })

    test('a controller handoff is published even for slots that stay in place', async () => {
      const { id } = await lobbyService.createLobby({
        name: 'Team lobby',
        map: BIG_GAME_HUNTERS.id,
        gameType: GameType.TeamMelee,
        gameSubType: 2,
        visibility: 'listed',
        user: host.user,
        client: host.client,
      })
      await joinLobby(joiner, id)

      // Bring the joiner into the host's team (which empties the joiner's old team)
      let lobby = lobbyService.lobbies.get(id)!
      const [, , joinerSlot] = findSlotByUserId(lobby, JOINER_USER.id)
      const controlledSlot = lobby.teams[0].slots.find(slot => slot.type === 'controlledOpen')!
      lobbyService.moveSlot({
        client: host.client,
        lobbyId: id,
        fromSlotId: joinerSlot!.id,
        toSlotId: controlledSlot.id,
      })

      // The host leaves for the empty team, handing their team's controlled slots to the joiner.
      // The slots that outlive the move keep their ids (the host's own slot gets recreated).
      lobby = lobbyService.lobbies.get(id)!
      const joinerSlotId = findSlotByUserId(lobby, JOINER_USER.id)[2]!.id
      const keptControlledIds = lobby.teams[0].slots
        .filter(slot => slot.type === 'controlledOpen')
        .map(slot => slot.id)
      expect(keptControlledIds.length).toBeGreaterThan(0)
      fakeNydus.publish.mockClear()
      lobbyService.moveSlot({
        client: host.client,
        lobbyId: id,
        fromSlotId: lobby.host.id,
        toSlotId: lobby.teams[1].slots[0].id,
      })

      // The handoff changes nothing about a kept slot but its controller, and clients decide who
      // gets the race picker from it, so it must still be part of the published diff
      for (const slotId of keptControlledIds) {
        expect(diffEvents(id)).toContainEqual(
          expect.objectContaining({
            type: 'slotChange',
            player: expect.objectContaining({ id: slotId, controlledBy: joinerSlotId }),
          }),
        )
      }
    })

    test('moving a computer into a controlled slot is rejected', async () => {
      const { id } = await lobbyService.createLobby({
        name: 'Team lobby',
        map: BIG_GAME_HUNTERS.id,
        gameType: GameType.TeamMelee,
        gameSubType: 2,
        visibility: 'listed',
        user: host.user,
        client: host.client,
      })
      let lobby = lobbyService.lobbies.get(id)!
      // Filling the empty second team with computers, the only way computers exist in team melee
      lobbyService.addComputer({ client: host.client, slotId: lobby.teams[1].slots[0].id })

      lobby = lobbyService.lobbies.get(id)!
      expect(lobby.teams[1].slots.every(slot => slot.type === 'computer')).toBe(true)
      const controlledSlot = lobby.teams[0].slots[1]
      expect(controlledSlot.type).toBe('controlledOpen')

      // A lone computer can't leave its team (removing one blanks the whole team), and a controlled
      // team only takes humans
      expect(() =>
        lobbyService.moveSlot({
          client: host.client,
          lobbyId: id,
          fromSlotId: lobby.teams[1].slots[0].id,
          toSlotId: controlledSlot.id,
        }),
      ).toThrow(expect.objectContaining({ code: LobbyServiceErrorCode.InvalidSlotType }))

      // The computer team must not have been dissolved by the rejected move
      const after = lobbyService.lobbies.get(id)!
      expect(after.teams[1].slots.every(slot => slot.type === 'computer')).toBe(true)
    })

    test('the host can move a player onto a controlled slot the host closed', async () => {
      const { id } = await lobbyService.createLobby({
        name: 'Team lobby',
        map: BIG_GAME_HUNTERS.id,
        gameType: GameType.TeamMelee,
        gameSubType: 2,
        visibility: 'listed',
        user: host.user,
        client: host.client,
      })
      let lobby = lobbyService.lobbies.get(id)!
      lobbyService.closeSlot({ client: host.client, slotId: lobby.teams[0].slots[1].id })
      lobby = lobbyService.lobbies.get(id)!
      const controlledClosedSlot = lobby.teams[0].slots[1]
      expect(controlledClosedSlot.type).toBe('controlledClosed')

      // The second team is still empty, so the joiner lands there rather than in the first team's
      // remaining controlled slot
      await joinLobby(joiner, id)
      lobby = lobbyService.lobbies.get(id)!
      const [, , joinerSlot] = findSlotByUserId(lobby, JOINER_USER.id)

      lobbyService.moveSlot({
        client: host.client,
        lobbyId: id,
        fromSlotId: joinerSlot!.id,
        toSlotId: controlledClosedSlot.id,
      })

      const updated = lobbyService.lobbies.get(id)!
      expect(updated.teams[0].slots[1].type).toBe('human')
      expect(updated.teams[0].slots[1].userId).toBe(JOINER_USER.id)
    })

    test('moving a computer onto a controlled slot the host closed is rejected', async () => {
      const { id } = await lobbyService.createLobby({
        name: 'Team lobby',
        map: BIG_GAME_HUNTERS.id,
        gameType: GameType.TeamMelee,
        gameSubType: 2,
        visibility: 'listed',
        user: host.user,
        client: host.client,
      })
      let lobby = lobbyService.lobbies.get(id)!
      lobbyService.closeSlot({ client: host.client, slotId: lobby.teams[0].slots[1].id })
      lobby = lobbyService.lobbies.get(id)!
      const controlledClosedSlot = lobby.teams[0].slots[1]
      expect(controlledClosedSlot.type).toBe('controlledClosed')

      // Filling the empty second team with computers, the only way computers exist in team melee
      lobbyService.addComputer({ client: host.client, slotId: lobby.teams[1].slots[0].id })
      lobby = lobbyService.lobbies.get(id)!

      expect(() =>
        lobbyService.moveSlot({
          client: host.client,
          lobbyId: id,
          fromSlotId: lobby.teams[1].slots[0].id,
          toSlotId: controlledClosedSlot.id,
        }),
      ).toThrow(expect.objectContaining({ code: LobbyServiceErrorCode.InvalidSlotType }))

      // The destination must still be closed, and the computer team intact
      const after = lobbyService.lobbies.get(id)!
      expect(after.teams[0].slots[1].type).toBe('controlledClosed')
      expect(after.teams[1].slots.every(slot => slot.type === 'computer')).toBe(true)
    })

    test('the host can move a player onto a closed observer slot, making them an observer', async () => {
      const { id } = await createLobby(host, 'Obs lobby', 'listed', true)
      await joinLobby(joiner, id)
      const lobby = lobbyService.lobbies.get(id)!
      const [, , joinerSlot] = findSlotByUserId(lobby, JOINER_USER.id)
      const [obsTeamIndex, obsTeam] = getObserverTeam(lobby)
      const obsSlot = obsTeam!.slots[0]
      expect(obsSlot.type).toBe('closed')

      lobbyService.moveSlot({
        client: host.client,
        lobbyId: id,
        fromSlotId: joinerSlot!.id,
        toSlotId: obsSlot.id,
      })

      const updated = lobbyService.lobbies.get(id)!
      expect(updated.teams[obsTeamIndex!].slots[0].type).toBe('observer')
      expect(updated.teams[obsTeamIndex!].slots[0].userId).toBe(JOINER_USER.id)
      expect(updated.teams[0].slots[1].type).toBe('open')
    })

    test('moving a computer onto a closed observer slot is rejected', async () => {
      const { id } = await createLobby(host, 'Obs lobby', 'listed', true)
      let lobby = lobbyService.lobbies.get(id)!
      lobbyService.addComputer({ client: host.client, slotId: lobby.teams[0].slots[1].id })

      lobby = lobbyService.lobbies.get(id)!
      const [, obsTeam] = getObserverTeam(lobby)
      const obsSlot = obsTeam!.slots[0]
      expect(obsSlot.type).toBe('closed')

      expect(() =>
        lobbyService.moveSlot({
          client: host.client,
          lobbyId: id,
          fromSlotId: lobby.teams[0].slots[1].id,
          toSlotId: obsSlot.id,
        }),
      ).toThrow(expect.objectContaining({ code: LobbyServiceErrorCode.ComputerInObserverSlot }))
    })

    test('only the host can move slots around', async () => {
      const { id } = await createLobby(host, 'Listed lobby', 'listed')
      await joinLobby(joiner, id)
      const lobby = lobbyService.lobbies.get(id)!
      const [, , joinerSlot] = findSlotByUserId(lobby, JOINER_USER.id)

      expect(() =>
        lobbyService.moveSlot({
          client: joiner.client,
          lobbyId: id,
          fromSlotId: joinerSlot!.id,
          toSlotId: lobby.teams[0].slots[4].id,
        }),
      ).toThrow(expect.objectContaining({ code: LobbyServiceErrorCode.NotHost }))
    })
  })

  describe('lobby id assertion', () => {
    test('an operation naming a different lobby than the client is in is rejected', async () => {
      const { id } = await createLobby(host, 'Listed lobby', 'listed')
      await joinLobby(joiner, id)

      const lobby = lobbyService.lobbies.get(id)!
      const [, , joinerSlot] = findSlotByUserId(lobby, JOINER_USER.id)

      expect(() =>
        lobbyService.kickPlayer({
          client: host.client,
          lobbyId: 'some-other-lobby' as SbLobbyId,
          slotId: joinerSlot!.id,
        }),
      ).toThrow(expect.objectContaining({ code: LobbyServiceErrorCode.NotInLobby }))

      // The operation must not have gone through against the lobby the client is actually in.
      expect(findSlotByUserId(lobbyService.lobbies.get(id)!, JOINER_USER.id)[2]).toBeDefined()
    })

    test('leaving binds to the requesting client, not the last active one', async () => {
      const { id } = await createLobby(host, 'Listed lobby', 'listed')
      // Another signed-in client of the same user that is in no lobby, e.g. a stale tab.
      const secondClient = connect(HOST_USER, 'SECOND_HOST_CLIENT')

      expect(() => lobbyService.leaveLobby({ client: secondClient.client, lobbyId: id })).toThrow(
        expect.objectContaining({ code: LobbyServiceErrorCode.NotInLobby }),
      )

      // The client that is actually seated must not have been removed.
      expect(findSlotByUserId(lobbyService.lobbies.get(id)!, HOST_USER.id)[2]).toBeDefined()
    })

    test('an operation naming the lobby the client is in is allowed', async () => {
      const { id } = await createLobby(host, 'Listed lobby', 'listed')
      await joinLobby(joiner, id)

      const lobby = lobbyService.lobbies.get(id)!
      const [, , joinerSlot] = findSlotByUserId(lobby, JOINER_USER.id)

      lobbyService.kickPlayer({
        client: host.client,
        lobbyId: id,
        slotId: joinerSlot!.id,
      })

      expect(findSlotByUserId(lobbyService.lobbies.get(id)!, JOINER_USER.id)[2]).toBeUndefined()
    })
  })

  describe('closeSlot', () => {
    test("closing the last seated member's slot is rejected", async () => {
      const { id } = await createLobby(host, 'Solo lobby', 'listed')

      // Removing the last seated member by closing their slot would either close the lobby out
      // from under the host or, with members on the bench, strand it with nobody seated
      expect(() =>
        lobbyService.closeSlot({
          client: host.client,
          slotId: lobbyService.lobbies.get(id)!.host.id,
        }),
      ).toThrow(expect.objectContaining({ code: LobbyServiceErrorCode.InvalidSlotOperation }))
      expect(lobbyService.lobbies.get(id)).toBeDefined()
    })

    test('closing an occupied observer slot kicks the occupant and leaves the slot closed', async () => {
      const { id } = await createLobby(host, 'Obs lobby', 'listed', true)
      await joinLobby(joiner, id)

      let lobby = lobbyService.lobbies.get(id)!
      const [, , joinerSlot] = findSlotByUserId(lobby, JOINER_USER.id)
      lobbyService.makeObserver({ client: host.client, slotId: joinerSlot!.id })

      lobby = lobbyService.lobbies.get(id)!
      const [obsTeamIndex, obsTeam] = getObserverTeam(lobby)
      const obsSlot = obsTeam!.slots[0]
      expect(obsSlot.type).toBe('observer')

      // Closing an occupied slot kicks the occupant and then closes whatever their removal left
      // behind, in one request
      lobbyService.closeSlot({ client: host.client, slotId: obsSlot.id })

      lobby = lobbyService.lobbies.get(id)!
      expect(lobby.teams[obsTeamIndex!].slots[0].type).toBe('closed')
      expect(findSlotByUserId(lobby, JOINER_USER.id)[2]).toBeUndefined()
    })
  })

  describe('changeSlot', () => {
    test('a member cannot change their own seat onto a closed slot', async () => {
      const { id } = await createLobby(host, 'Listed lobby', 'listed')
      await joinLobby(joiner, id)
      const lobby = lobbyService.lobbies.get(id)!
      lobbyService.closeSlot({ client: host.client, slotId: lobby.teams[0].slots[4].id })
      const closedSlot = lobbyService.lobbies.get(id)!.teams[0].slots[4]

      // Closed slots are host-reserved; only the host's move-slot flow can seat someone onto one
      expect(() =>
        lobbyService.changeSlot({ client: joiner.client, slotId: closedSlot.id }),
      ).toThrow(expect.objectContaining({ code: LobbyServiceErrorCode.InvalidSlotType }))
    })
  })

  describe('removeObserver', () => {
    test('the observer slot it frees goes to the member who has been waiting', async () => {
      const { id } = await createLobby(host, 'Obs lobby', 'listed', true, GameType.OneVsOne)
      await joinLobby(joiner, id)

      // The joiner watches instead of playing, and the host closes the seat they left behind, so
      // the lobby has nowhere for anyone new to sit
      let lobby = lobbyService.lobbies.get(id)!
      const [, , joinerSlot] = findSlotByUserId(lobby, JOINER_USER.id)
      lobbyService.makeObserver({ client: host.client, slotId: joinerSlot!.id })
      lobby = lobbyService.lobbies.get(id)!
      lobbyService.closeSlot({ client: host.client, slotId: lobby.teams[0].slots[1].id })
      await joinLobby(otherHost, id)
      expect(lobbyService.lobbies.get(id)!.bench.map(b => b.userId)).toEqual([OTHER_HOST_USER.id])

      lobby = lobbyService.lobbies.get(id)!
      const [obsTeamIndex, obsTeam] = getObserverTeam(lobby)
      const obsSlot = obsTeam!.slots.find(s => s.type === 'observer')!
      lobbyService.removeObserver({ client: host.client, slotId: obsSlot.id })

      // Sending the observer back to a player slot leaves theirs open, which is exactly the kind of
      // seat the bench is waiting for
      const updated = lobbyService.lobbies.get(id)!
      expect(updated.bench).toHaveLength(0)
      expect(findSlotByUserId(updated, JOINER_USER.id)[2]!.type).toBe('human')
      const [seatedTeamIndex, , seatedSlot] = findSlotByUserId(updated, OTHER_HOST_USER.id)
      expect(seatedTeamIndex).toBe(obsTeamIndex)
      expect(seatedSlot!.type).toBe('observer')
    })
  })

  describe('summaries', () => {
    test('a counting-down lobby is reported as gone by the summary getter', async () => {
      const { id } = await createLobby(host, 'Listed lobby', 'listed')
      await joinLobby(joiner, id)

      // It can no longer be joined, so the unauthenticated summary endpoint and page-metadata
      // resolver must treat it the same as a lobby that doesn't exist at all.
      vi.useFakeTimers()
      lobbyService.startCountdown({ client: host.client })

      expect(getLobbySummary(id)).toBeUndefined()
    })

    test('a lobby with a game in progress reports its summary', async () => {
      const { id } = await createLobby(host, 'Listed lobby', 'listed')
      await joinLobby(joiner, id)

      await runCountdown(host)

      // Someone following an invite link mid-game still gets the lobby, since they can join its
      // bench and play the next game with everyone else.
      expect(getLobbySummary(id)).toEqual(expect.objectContaining({ id, lifecycle: 'inGame' }))
    })
  })

  describe('game config', () => {
    test('records visibility and an empty observers list for a listed lobby with no observers', async () => {
      const { id } = await createLobby(host, 'Listed lobby', 'listed')
      await joinLobby(joiner, id)

      await runCountdown(host)

      expect(loadGameRequests).toHaveLength(1)
      expect(loadGameRequests[0].gameConfig.gameSourceExtra).toMatchObject({
        visibility: 'listed',
      })
      expect(loadGameRequests[0].gameConfig.observers).toEqual([])
    })

    test('records visibility for an unlisted lobby', async () => {
      const { id } = await createLobby(otherHost, 'Unlisted lobby', 'unlisted')
      await joinLobby(lister, id)

      await runCountdown(otherHost)

      expect(loadGameRequests).toHaveLength(1)
      expect(loadGameRequests[0].gameConfig.gameSourceExtra).toMatchObject({
        visibility: 'unlisted',
      })
    })

    test('records seated observers in the observers list', async () => {
      const { id } = await createLobby(host, 'Listed lobby', 'listed', true)
      await joinLobby(joiner, id)
      await joinLobby(lister, id)

      const lobby = lobbyService.lobbies.get(id)!
      const [, , listerSlot] = findSlotByUserId(lobby, LISTER_USER.id)
      lobbyService.makeObserver({ client: host.client, slotId: listerSlot!.id })

      await runCountdown(host)

      expect(loadGameRequests).toHaveLength(1)
      expect(loadGameRequests[0].gameConfig.observers).toEqual([LISTER_USER.id])
      // The observer must not appear as a participant in any team
      expect(loadGameRequests[0].gameConfig.teams.flat()).not.toContainEqual(
        expect.objectContaining({ id: LISTER_USER.id }),
      )
    })
  })

  describe('running a game', () => {
    /** Creates a lobby with `host` and `joiner` seated, and runs it into a started game. */
    async function createLobbyInGame() {
      const { id } = await createLobby(host, 'Listed lobby', 'listed')
      await joinLobby(joiner, id)
      await runCountdown(host)
      return id
    }

    test('a started game keeps the lobby, with everyone in it and in their activity', async () => {
      const id = await createLobbyInGame()

      expect(lobbyService.lobbies.has(id)).toBe(true)
      expect(lobbyPublishes(id)).toContainEqual({
        type: 'gameStarted',
        runState: { gameId: 'test-game-id', inGameUsers: [HOST_USER.id, JOINER_USER.id] },
      })
      // Holding the activity through the game is what keeps everyone out of matchmaking and other
      // lobbies until this one is done with them.
      expect(activityRegistry.getClientForUser(HOST_USER.id)).toBe(host.client)
      expect(activityRegistry.getClientForUser(JOINER_USER.id)).toBe(joiner.client)
      expect(lobbyService.lobbyClients.get(host.client)).toBe(id)
    })

    test('a started lobby goes back on the list marked as being in a game', async () => {
      const id = await createLobbyInGame()

      expect(listPublishes().at(-1)).toEqual({
        action: 'add',
        payload: expect.objectContaining({ id, lifecycle: 'inGame' }),
      })
      expect(lobbyService.getListedSummaries().map(l => l.lifecycle)).toEqual(['inGame'])
    })

    test('a member whose game ends is announced and dropped from the run state', async () => {
      const id = await createLobbyInGame()
      fakeNydus.publish.mockClear()

      endGameFor(joiner)

      expect(lobbyPublishes(id)).toEqual([{ type: 'memberGameEnded', userId: JOINER_USER.id }])
      expect([...lobbyService.runStates.get(id)!.inGameUsers]).toEqual([HOST_USER.id])
    })

    test('a whole-game end signal regroups everyone still marked as playing', async () => {
      const id = await createLobbyInGame()
      fakeNydus.publish.mockClear()

      // Nobody reported individually - e.g. both apps crashed - but the relay session closing
      // fired the authoritative whole-game signal.
      gameLifecycleEvents.emit('gameEnded', { gameId: 'test-game-id' })

      expect(lobbyService.runStates.has(id)).toBe(false)
      expect(lobbyPublishes(id)).toEqual([{ type: 'regroup', gameId: 'test-game-id' }])
    })

    test('a whole-game end for a game no lobby is running is ignored', async () => {
      const id = await createLobbyInGame()
      fakeNydus.publish.mockClear()

      gameLifecycleEvents.emit('gameEnded', { gameId: 'a-different-game' })

      expect(lobbyService.runStates.has(id)).toBe(true)
      expect(lobbyPublishes(id)).toEqual([])
    })

    test('a repeated signal for a member who is already out is ignored', async () => {
      const id = await createLobbyInGame()
      fakeNydus.publish.mockClear()

      // A status report and a result report both arrive for the same player and game.
      endGameFor(joiner)
      endGameFor(joiner)

      expect(lobbyPublishes(id)).toEqual([{ type: 'memberGameEnded', userId: JOINER_USER.id }])
    })

    test('a signal naming a game the lobby is not running is ignored', async () => {
      const id = await createLobbyInGame()
      fakeNydus.publish.mockClear()

      endGameFor(joiner, 'a-different-game')

      expect(lobbyPublishes(id)).toEqual([])
      expect([...lobbyService.runStates.get(id)!.inGameUsers]).toEqual([
        HOST_USER.id,
        JOINER_USER.id,
      ])
    })

    test('the lobby regroups with its seats and races once everyone is done', async () => {
      const { id } = await createLobby(host, 'Listed lobby', 'listed')
      await joinLobby(joiner, id)
      const [, , joinerSlot] = findSlotByUserId(lobbyService.lobbies.get(id)!, JOINER_USER.id)
      lobbyService.setRace({ client: joiner.client, slotId: joinerSlot!.id, race: 'z' })
      await runCountdown(host)
      fakeNydus.publish.mockClear()

      endGameFor(host)
      endGameFor(joiner)

      expect(lobbyService.runStates.has(id)).toBe(false)
      expect(lobbyPublishes(id)).toContainEqual({ type: 'regroup', gameId: 'test-game-id' })
      const lobby = lobbyService.lobbies.get(id)!
      expect(findSlotByUserId(lobby, HOST_USER.id)[2]).toBeDefined()
      expect(findSlotByUserId(lobby, JOINER_USER.id)[2]!.race).toBe('z')
      expect(getLobbySummary(id)!.lifecycle).toBe('gathering')
      expect(listPublishes().at(-1)).toEqual({
        action: 'update',
        payload: expect.objectContaining({ id, lifecycle: 'gathering' }),
      })
    })

    test('joining while a game is running lands on the bench even with seats open', async () => {
      const id = await createLobbyInGame()
      // The seats that are still open belong to a game in progress, not to whoever shows up next.
      expect(openSlotCount(lobbyService.lobbies.get(id)!)).toBeGreaterThan(0)
      fakeNydus.publish.mockClear()

      await joinLobby(otherHost, id)

      const lobby = lobbyService.lobbies.get(id)!
      expect(findSlotByUserId(lobby, OTHER_HOST_USER.id)[2]).toBeUndefined()
      expect(lobby.bench.map(b => b.userId)).toEqual([OTHER_HOST_USER.id])
      expect(diffEvents(id)).toContainEqual({
        type: 'benchAdd',
        user: expect.objectContaining({ userId: OTHER_HOST_USER.id }),
      })
    })

    test('joining a lobby that is loading its game rejects with a JoinAlreadyStarted code', async () => {
      const { id } = await createLobby(host, 'Listed lobby', 'listed')
      await joinLobby(joiner, id)
      lobbyService.loadingLobbies.set(id, new AbortController())

      await expect(joinLobby(otherHost, id)).rejects.toMatchObject({
        code: LobbyServiceErrorCode.JoinAlreadyStarted,
      })
    })

    test('a member who joined during the game is seated when the lobby regroups', async () => {
      const id = await createLobbyInGame()
      await joinLobby(otherHost, id)

      endGameFor(host)
      endGameFor(joiner)

      const lobby = lobbyService.lobbies.get(id)!
      expect(lobby.bench).toHaveLength(0)
      expect(findSlotByUserId(lobby, OTHER_HOST_USER.id)[2]!.type).toBe('human')
    })

    test('slot operations, settings changes, and a new countdown are rejected', async () => {
      const id = await createLobbyInGame()
      const openSlot = lobbyService.lobbies.get(id)!.teams[0].slots[2]

      expect(() => lobbyService.closeSlot({ client: host.client, slotId: openSlot.id })).toThrow(
        expect.objectContaining({ code: LobbyServiceErrorCode.GameInProgress }),
      )
      await expect(
        lobbyService.updateSettings({ client: host.client, lobbyId: id, useLegacyLimits: true }),
      ).rejects.toMatchObject({ code: LobbyServiceErrorCode.GameInProgress })
      expect(() => lobbyService.startCountdown({ client: host.client })).toThrow(
        expect.objectContaining({ code: LobbyServiceErrorCode.GameInProgress }),
      )
    })

    test('a member on the bench cannot take a seat until the game is over', async () => {
      const id = await createLobbyInGame()
      await joinLobby(otherHost, id)
      const openSlot = lobbyService.lobbies.get(id)!.teams[0].slots[2]

      expect(() =>
        lobbyService.changeSlot({ client: otherHost.client, slotId: openSlot.id }),
      ).toThrow(expect.objectContaining({ code: LobbyServiceErrorCode.GameInProgress }))
    })

    test('the host can kick a benched member during a game but not a seated one', async () => {
      const id = await createLobbyInGame()
      await joinLobby(otherHost, id)
      const [, , joinerSlot] = findSlotByUserId(lobbyService.lobbies.get(id)!, JOINER_USER.id)

      expect(() =>
        lobbyService.kickPlayer({ client: host.client, slotId: joinerSlot!.id }),
      ).toThrow(expect.objectContaining({ code: LobbyServiceErrorCode.GameInProgress }))

      // Someone waiting for a seat has no slot, so the host names them by their user id
      lobbyService.kickPlayer({ client: host.client, slotId: String(OTHER_HOST_USER.id) })

      expect(lobbyService.lobbies.get(id)!.bench).toHaveLength(0)
      expect(lobbyService.lobbyClients.has(otherHost.client)).toBe(false)
    })

    test('a member leaving during a game leaves the lobby and can regroup it', async () => {
      const id = await createLobbyInGame()
      endGameFor(joiner)
      fakeNydus.publish.mockClear()

      lobbyService.leaveLobby({ client: host.client })

      expect(lobbyService.runStates.has(id)).toBe(false)
      expect(lobbyPublishes(id)).toContainEqual({ type: 'regroup', gameId: 'test-game-id' })
      const lobby = lobbyService.lobbies.get(id)!
      expect(findSlotByUserId(lobby, HOST_USER.id)[2]).toBeUndefined()
      expect(lobby.host.userId).toBe(JOINER_USER.id)
    })

    test('the last in-game member disconnecting regroups the lobby', async () => {
      const id = await createLobbyInGame()
      await joinLobby(otherHost, id)
      endGameFor(host)
      fakeNydus.publish.mockClear()

      // An app that dies mid-game never reports anything; only its socket closing says it is gone.
      joiner.socket.disconnect()

      expect(lobbyService.runStates.has(id)).toBe(false)
      expect(lobbyPublishes(id)).toContainEqual({ type: 'regroup', gameId: 'test-game-id' })
      const lobby = lobbyService.lobbies.get(id)!
      expect(findSlotByUserId(lobby, JOINER_USER.id)[2]).toBeUndefined()
      expect(findSlotByUserId(lobby, OTHER_HOST_USER.id)[2]!.type).toBe('human')
    })

    test('a lobby that empties during its game drops its run state', async () => {
      const id = await createLobbyInGame()

      lobbyService.leaveLobby({ client: host.client })
      lobbyService.leaveLobby({ client: joiner.client })

      expect(lobbyService.lobbies.has(id)).toBe(false)
      expect(lobbyService.runStates.has(id)).toBe(false)
    })

    test('the lobby can start another game once it has regrouped', async () => {
      const id = await createLobbyInGame()
      endGameFor(host)
      endGameFor(joiner)

      await runCountdown(host)

      expect(loadGameRequests).toHaveLength(2)
      expect(lobbyService.runStates.get(id)!.gameId).toBe('test-game-id')
      expect(lobbyPublishes(id).filter(data => data?.type === 'gameStarted')).toHaveLength(2)
    })
  })
})
