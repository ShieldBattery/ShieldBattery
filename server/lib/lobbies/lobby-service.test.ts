import { NydusServer } from 'nydus'
import { Result } from 'typescript-result'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { GameServerRegion, makeGameServerRegionId } from '../../../common/game-server-regions'
import { GameType } from '../../../common/games/game-type'
import { findSlotByUserId, getObserverTeam, LobbyVisibility } from '../../../common/lobbies'
import { isValidJoinCode } from '../../../common/lobbies/join-code'
import { SbLobbyId } from '../../../common/lobbies/sb-lobby-id'
import { makeSbMapId, MapInfo, MapVisibility, Tileset } from '../../../common/maps'
import { RaceChar } from '../../../common/races'
import { asMockedFunction } from '../../../common/testing/mocks'
import { SbUser } from '../../../common/users/sb-user'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { GameServerRegionsService } from '../game-server-regions/game-server-regions-service'
import { GameLoader, GameLoadRequest } from '../games/game-loader'
import { GameplayActivityRegistry } from '../games/gameplay-activity-registry'
import { getMapInfos } from '../maps/map-models'
import { reparseMapsAsNeeded } from '../maps/map-operations'
import { NetcodeV2Service } from '../netcode-v2/netcode-v2-service'
import { RestrictionService } from '../users/restriction-service'
import { createFakeActivityStatusService } from '../users/testing/activity-status-service'
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
  NydusConnector,
} from '../websockets/testing/websockets'
import { TypedPublisher } from '../websockets/typed-publisher'
import { openSlot } from './lobby'
import { knownRegionOrUndefined, LobbyService, LobbyServiceErrorCode } from './lobby-service'
import { getLobbyIdByJoinCode, getLobbyJoinCode, getLobbySummary } from './lobby-summaries'

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
}

describe('lobbies/lobby-service', () => {
  let nydus: NydusServer
  let fakeNydus: FakeNydusServer
  let lobbyService: LobbyService

  let host: Sockets
  let joiner: Sockets
  let otherHost: Sockets
  let lister: Sockets

  /** Connects a further client (another tab/machine of `user`) and returns its socket groups. */
  let connect: (user: SbUser, clientId: string) => Sockets

  /** Every request the stubbed `GameLoader` received via `loadGame`, in call order. */
  let loadGameRequests: GameLoadRequest[]

  /** Returns the data published on the public lobby list channel, in order. */
  function listPublishes(): Array<{ action: string; payload: any }> {
    return fakeNydus.publish.mock.calls
      .filter(([path]) => path === '/lobbies')
      .map(([, data]) => data)
  }

  /** Returns the data published on a single lobby's preview channel, in order. */
  function previewPublishes(lobbyId: SbLobbyId): Array<{ action: string; payload: any }> {
    return fakeNydus.publish.mock.calls
      .filter(([path]) => path === `/lobbies/${lobbyId}/preview`)
      .map(([, data]) => data)
  }

  /** Returns every open-lobby count published, in order. */
  function countPublishes(): Array<{ count: number }> {
    return fakeNydus.publish.mock.calls
      .filter(([path]) => path === '/lobbiesCount')
      .map(([, data]) => data)
  }

  /** Returns the most recently published open-lobby count, or undefined if none was published. */
  function latestLobbiesCount(): number | undefined {
    const counts = countPublishes()
    return counts.length ? counts[counts.length - 1].count : undefined
  }

  async function createLobby(
    sockets: Sockets,
    name: string,
    visibility?: LobbyVisibility,
    allowObservers?: boolean,
    gameType = GameType.Melee,
    leaveCurrentLobby?: boolean,
  ) {
    return await lobbyService.createLobby({
      name,
      map: BIG_GAME_HUNTERS.id,
      gameType,
      visibility,
      allowObservers,
      leaveCurrentLobby,
      user: sockets.user,
      client: sockets.client,
    })
  }

  function joinLobby(
    sockets: Sockets,
    id: SbLobbyId,
    region?: string,
    asObserver?: boolean,
    leaveCurrentLobby?: boolean,
  ) {
    return lobbyService.joinLobby({
      id,
      region: region !== undefined ? makeGameServerRegionId(region) : undefined,
      asObserver,
      leaveCurrentLobby,
      user: sockets.user,
      client: sockets.client,
    })
  }

  beforeEach(() => {
    nydus = createFakeNydusServer()
    fakeNydus = nydus as unknown as FakeNydusServer
    const sessionLookup = new RequestSessionLookup()
    const clientSockets = new ClientSocketsManager(nydus, sessionLookup)
    const userSockets = new UserSocketsManager(nydus, sessionLookup, async () => {})

    loadGameRequests = []
    lobbyService = new LobbyService(
      new TypedPublisher(nydus),
      new GameplayActivityRegistry(createFakeActivityStatusService()),
      {
        loadGame: vi.fn(async (request: GameLoadRequest) => {
          loadGameRequests.push(request)
          return Result.ok({ gameId: 'test-game-id' })
        }),
      } as unknown as GameLoader,
      {
        isRestricted: async () => false,
      } as unknown as RestrictionService,
      {
        getRegions: async () => [],
      } as unknown as GameServerRegionsService,
      {
        warmRegions: () => {},
      } as unknown as NetcodeV2Service,
      userSockets,
    )

    asMockedFunction(getMapInfos).mockResolvedValue([BIG_GAME_HUNTERS])
    asMockedFunction(reparseMapsAsNeeded).mockResolvedValue([BIG_GAME_HUNTERS])
    asMockedFunction(findUsersById).mockResolvedValue([])

    const connector = new NydusConnector(nydus, sessionLookup)
    connect = (user: SbUser, clientId: string): Sockets => {
      connector.connectClient(user, clientId)
      return {
        user: userSockets.getById(user.id)!,
        client: clientSockets.getById(user.id, clientId)!,
      }
    }
    host = connect(HOST_USER, 'HOST_CLIENT')
    joiner = connect(JOINER_USER, 'JOINER_CLIENT')
    otherHost = connect(OTHER_HOST_USER, 'OTHER_HOST_CLIENT')
    lister = connect(LISTER_USER, 'LISTER_CLIENT')

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

    test('creating a listed lobby with a name matching an existing listed lobby succeeds', async () => {
      await createLobby(host, 'Duplicate name', 'listed')

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

  describe('list and preview publishing', () => {
    /** Sets `user`'s race in the lobby they're in, the way a client request would. */
    function setRace(sockets: Sockets, lobbyId: SbLobbyId, race: RaceChar) {
      const [, , slot] = findSlotByUserId(lobbyService.lobbies.get(lobbyId)!, sockets.user.userId)
      lobbyService.setRace({ client: sockets.client, slotId: slot!.id, race })
    }

    test('a race change reaches previewers without touching the list or the lobby count', async () => {
      const { id } = await createLobby(host, 'Listed lobby', 'listed')
      await joinLobby(joiner, id)
      fakeNydus.publish.mockClear()

      setRace(joiner, id, 'z')

      const previews = previewPublishes(id)
      expect(previews).toHaveLength(1)
      expect(previews[0].payload.teams[0].slots[1]).toMatchObject({ race: 'z' })
      // Nothing a row shows changed, so neither the list nor the count everyone is subscribed to
      // has any reason to hear about it.
      expect(listPublishes()).toEqual([])
      expect(countPublishes()).toEqual([])
    })

    test('a join reaches both the list and previewers', async () => {
      const { id } = await createLobby(host, 'Listed lobby', 'listed')
      fakeNydus.publish.mockClear()

      await joinLobby(joiner, id)

      expect(listPublishes()).toEqual([
        {
          action: 'update',
          payload: expect.objectContaining({
            playerSlots: expect.objectContaining({ taken: 2 }),
            occupantIds: [HOST_USER.id, JOINER_USER.id],
          }),
        },
      ])
      expect(previewPublishes(id)).toHaveLength(1)
      // The lobby was already listed and still is, so the open-lobby count is unchanged.
      expect(countPublishes()).toEqual([])
    })

    test('a leave reaches both the list and previewers', async () => {
      const { id } = await createLobby(host, 'Listed lobby', 'listed')
      await joinLobby(joiner, id)
      fakeNydus.publish.mockClear()

      lobbyService.leaveLobby({ client: joiner.client })

      expect(listPublishes()).toEqual([
        {
          action: 'update',
          payload: expect.objectContaining({ occupantIds: [HOST_USER.id] }),
        },
      ])
      expect(previewPublishes(id)).toHaveLength(1)
    })

    test('an unlisted lobby still reaches its previewers', async () => {
      // Holding a lobby's id is what grants a preview of it, so an unlisted lobby previews exactly
      // like a listed one even though it never appears on the public list.
      const { id } = await createLobby(host, 'Unlisted lobby', 'unlisted')
      fakeNydus.publish.mockClear()

      await joinLobby(joiner, id)

      expect(listPublishes()).toEqual([])
      expect(previewPublishes(id)).toHaveLength(1)
      expect(previewPublishes(id)[0].payload.occupantIds).toEqual([HOST_USER.id, JOINER_USER.id])
    })

    test('the preview carries the slot layout the summary leaves out', async () => {
      const { id } = await createLobby(host, 'Listed lobby', 'listed')
      fakeNydus.publish.mockClear()

      await joinLobby(joiner, id)

      expect(previewPublishes(id)[0].payload).toHaveProperty('teams')
      expect((listPublishes()[0].payload as any).teams).toBeUndefined()
    })
  })

  describe('join', () => {
    test('joining an unknown lobby id rejects with a NoLobby code', async () => {
      await expect(joinLobby(joiner, 'nonexistent-lobby' as SbLobbyId)).rejects.toMatchObject({
        code: LobbyServiceErrorCode.NoLobby,
      })
    })

    test('joining a full lobby rejects with a LobbyFull code', async () => {
      const { id } = await createLobby(host, 'Full lobby', 'listed', undefined, GameType.OneVsOne)
      // 1v1 lobbies only have 2 slots, and the host already occupies one.
      await joinLobby(joiner, id)

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

    test('an explicit observer join seats the joiner in an open observer slot', async () => {
      const { id } = await createLobby(host, 'Listed lobby', 'listed', true)
      const lobby = lobbyService.lobbies.get(id)!
      const [obsTeamIndex] = getObserverTeam(lobby)
      // Every observer slot starts closed; open one directly, since opening one is its own
      // operation with its own coverage elsewhere. This test only cares what a join does with one
      // available.
      lobbyService.lobbies.set(id, openSlot(lobby, obsTeamIndex!, 0))

      await joinLobby(joiner, id, undefined, true)

      const updated = lobbyService.lobbies.get(id)!
      const [, , joinerSlot] = findSlotByUserId(updated, JOINER_USER.id)
      expect(joinerSlot!.type).toBe('observer')
    })

    test('an explicit observer join rejects with ObserversFull when the lobby has no observer team', async () => {
      const { id } = await createLobby(host, 'Listed lobby', 'listed', false)

      await expect(joinLobby(joiner, id, undefined, true)).rejects.toMatchObject({
        code: LobbyServiceErrorCode.ObserversFull,
      })
      const lobby = lobbyService.lobbies.get(id)!
      expect(findSlotByUserId(lobby, JOINER_USER.id)[2]).toBeUndefined()
    })

    test('an explicit observer join rejects with ObserversFull when every observer slot is closed', async () => {
      const { id } = await createLobby(host, 'Listed lobby', 'listed', true)

      // An explicit observer request must never fall back to a player slot, unlike an ordinary
      // join that happens to land in the observer team.
      await expect(joinLobby(joiner, id, undefined, true)).rejects.toMatchObject({
        code: LobbyServiceErrorCode.ObserversFull,
      })
      const lobby = lobbyService.lobbies.get(id)!
      expect(findSlotByUserId(lobby, JOINER_USER.id)[2]).toBeUndefined()
    })

    test('joining a lobby the client is already in resolves as a no-op', async () => {
      const { id } = await createLobby(host, 'Listed lobby', 'listed')
      await joinLobby(joiner, id)
      const before = lobbyService.lobbies.get(id)!

      await expect(joinLobby(joiner, id)).resolves.toBeUndefined()

      // The lobby object is untouched: the join returned before doing anything, rather than
      // re-seating the joiner into a second slot.
      expect(lobbyService.lobbies.get(id)).toBe(before)
    })

    test('joining a different lobby without leaveCurrentLobby still rejects with JoinAlreadyInActivity', async () => {
      const { id: ownId } = await createLobby(host, 'Own lobby', 'listed')
      await joinLobby(joiner, ownId)

      const { id: otherId } = await createLobby(otherHost, 'Other lobby', 'listed')

      await expect(joinLobby(joiner, otherId)).rejects.toMatchObject({
        code: LobbyServiceErrorCode.JoinAlreadyInActivity,
      })

      // The rejected join must not have disturbed the client's existing membership.
      const ownLobby = lobbyService.lobbies.get(ownId)!
      expect(findSlotByUserId(ownLobby, JOINER_USER.id)[2]).toBeDefined()
    })

    test('joining with leaveCurrentLobby while a member of another lobby moves the client between them', async () => {
      const { id: oldId } = await createLobby(otherHost, 'Old lobby', 'listed')
      await joinLobby(joiner, oldId)

      const { id: newId } = await createLobby(host, 'New lobby', 'listed')

      await joinLobby(joiner, newId, undefined, undefined, true)

      const newLobby = lobbyService.lobbies.get(newId)!
      expect(findSlotByUserId(newLobby, JOINER_USER.id)[2]).toBeDefined()

      const oldLobby = lobbyService.lobbies.get(oldId)!
      expect(findSlotByUserId(oldLobby, JOINER_USER.id)[2]).toBeUndefined()
    })

    test('joining with leaveCurrentLobby while hosting another lobby closes it', async () => {
      const { id: oldId } = await createLobby(host, 'Old lobby', 'listed')
      const { id: newId } = await createLobby(otherHost, 'New lobby', 'listed')

      await joinLobby(host, newId, undefined, undefined, true)

      const newLobby = lobbyService.lobbies.get(newId)!
      expect(findSlotByUserId(newLobby, HOST_USER.id)[2]).toBeDefined()
      // The host was the old lobby's only occupant, so leaving it behind closes it entirely.
      expect(lobbyService.lobbies.has(oldId)).toBe(false)
    })

    test('joining with leaveCurrentLobby while hosting an occupied lobby hands off the host role instead of closing it', async () => {
      const { id: oldId } = await createLobby(host, 'Old lobby', 'listed')
      await joinLobby(lister, oldId)

      const { id: newId } = await createLobby(otherHost, 'New lobby', 'listed')

      await joinLobby(host, newId, undefined, undefined, true)

      const newLobby = lobbyService.lobbies.get(newId)!
      expect(findSlotByUserId(newLobby, HOST_USER.id)[2]).toBeDefined()

      // The old lobby still had another occupant, so it survives the host's departure with the
      // host role handed off, rather than closing behind them.
      expect(lobbyService.lobbies.has(oldId)).toBe(true)
      const oldLobby = lobbyService.lobbies.get(oldId)!
      expect(findSlotByUserId(oldLobby, HOST_USER.id)[2]).toBeUndefined()
      expect(oldLobby.host.userId).toBe(LISTER_USER.id)
    })

    test('leaveCurrentLobby does not leave the current lobby when the target join fails', async () => {
      const { id: ownId } = await createLobby(host, 'Own lobby', 'listed')
      await joinLobby(joiner, ownId)

      const { id: fullId } = await createLobby(
        otherHost,
        'Full lobby',
        'listed',
        undefined,
        GameType.OneVsOne,
      )
      // 1v1 lobbies only have 2 slots, and the host already occupies one.
      await joinLobby(lister, fullId)

      await expect(joinLobby(joiner, fullId, undefined, undefined, true)).rejects.toMatchObject({
        code: LobbyServiceErrorCode.LobbyFull,
      })

      // The failed join must not have removed the client from its actual lobby.
      const ownLobby = lobbyService.lobbies.get(ownId)!
      expect(findSlotByUserId(ownLobby, JOINER_USER.id)[2]).toBeDefined()
    })
  })

  describe('create with leaveCurrentLobby', () => {
    test('creating while a member of another lobby seats them as host and removes them from the old one', async () => {
      const { id: oldId } = await createLobby(host, 'Old lobby', 'listed')
      await joinLobby(joiner, oldId)

      const { id: newId } = await createLobby(
        joiner,
        'New lobby',
        'listed',
        undefined,
        GameType.Melee,
        true,
      )

      const newLobby = lobbyService.lobbies.get(newId)!
      expect(newLobby.host.userId).toBe(JOINER_USER.id)

      const oldLobby = lobbyService.lobbies.get(oldId)!
      expect(findSlotByUserId(oldLobby, JOINER_USER.id)[2]).toBeUndefined()
    })

    test('creating while hosting an occupied lobby hands off the host role instead of closing it', async () => {
      const { id: oldId } = await createLobby(host, 'Old lobby', 'listed')
      await joinLobby(lister, oldId)

      const { id: newId } = await createLobby(
        host,
        'New lobby',
        'listed',
        undefined,
        GameType.Melee,
        true,
      )

      const newLobby = lobbyService.lobbies.get(newId)!
      expect(newLobby.host.userId).toBe(HOST_USER.id)

      // The old lobby still had another occupant, so it survives the host's departure with the
      // host role handed off, rather than closing behind them.
      expect(lobbyService.lobbies.has(oldId)).toBe(true)
      const oldLobby = lobbyService.lobbies.get(oldId)!
      expect(findSlotByUserId(oldLobby, HOST_USER.id)[2]).toBeUndefined()
      expect(oldLobby.host.userId).toBe(LISTER_USER.id)
    })

    test('creating while hosting alone closes the old lobby', async () => {
      const { id: oldId } = await createLobby(host, 'Old lobby', 'listed')

      const { id: newId } = await createLobby(
        host,
        'New lobby',
        'listed',
        undefined,
        GameType.Melee,
        true,
      )

      expect(lobbyService.lobbies.has(newId)).toBe(true)
      // The host was the old lobby's only occupant, so leaving it behind closes it entirely.
      expect(lobbyService.lobbies.has(oldId)).toBe(false)
    })

    test('leaveCurrentLobby does not leave the current lobby when the create fails', async () => {
      const { id: ownId } = await createLobby(host, 'Own lobby', 'listed')
      await joinLobby(joiner, ownId)

      // Simulates the map having gone missing between the client fetching it and submitting.
      asMockedFunction(getMapInfos).mockResolvedValueOnce([])

      await expect(
        createLobby(joiner, 'Invalid map lobby', 'listed', undefined, GameType.Melee, true),
      ).rejects.toMatchObject({
        code: LobbyServiceErrorCode.InvalidMap,
      })

      // The failed create must not have removed the client from its actual lobby.
      const ownLobby = lobbyService.lobbies.get(ownId)!
      expect(findSlotByUserId(ownLobby, JOINER_USER.id)[2]).toBeDefined()
    })

    test('creating a lobby while already in one without leaveCurrentLobby still rejects with AlreadyInActivity', async () => {
      const { id: ownId } = await createLobby(host, 'Own lobby', 'listed')
      await joinLobby(joiner, ownId)

      await expect(createLobby(joiner, 'New lobby', 'listed')).rejects.toMatchObject({
        code: LobbyServiceErrorCode.AlreadyInActivity,
      })

      // The rejected create must not have disturbed the client's existing membership.
      const ownLobby = lobbyService.lobbies.get(ownId)!
      expect(findSlotByUserId(ownLobby, JOINER_USER.id)[2]).toBeDefined()
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

    test('the host closing their own slot while being the sole occupant just removes the lobby', async () => {
      const { id } = await createLobby(host, 'Solo lobby', 'listed')

      const lobby = lobbyService.lobbies.get(id)!
      const [, , hostSlot] = findSlotByUserId(lobby, HOST_USER.id)

      // Kicking the host empties the lobby before the slot itself can be closed, so there is
      // nothing left to close; this should be a clean no-op rather than an error.
      expect(() =>
        lobbyService.closeSlot({ client: host.client, slotId: hostSlot!.id }),
      ).not.toThrow()

      expect(lobbyService.lobbies.get(id)).toBeUndefined()
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
  })

  describe('join codes', () => {
    test('a created lobby gets a resolvable, well-formed join code', async () => {
      const { id } = await createLobby(host, 'Listed lobby', 'listed')

      const code = getLobbyJoinCode(id)
      expect(code).toBeDefined()
      expect(isValidJoinCode(code!)).toBe(true)
      expect(getLobbyIdByJoinCode(code!)).toBe(id)
    })

    test('lobbies created in the same run get distinct join codes', async () => {
      const { id: idA } = await createLobby(host, 'Lobby A', 'listed')
      const { id: idB } = await createLobby(otherHost, 'Lobby B', 'listed')

      expect(getLobbyJoinCode(idA)).not.toBe(getLobbyJoinCode(idB))
    })

    test('the join code stops resolving once the last player leaves', async () => {
      const { id } = await createLobby(host, 'Solo lobby', 'listed')
      const code = getLobbyJoinCode(id)!

      lobbyService.leaveLobby({ client: host.client })

      expect(getLobbyJoinCode(id)).toBeUndefined()
      expect(getLobbyIdByJoinCode(code)).toBeUndefined()
    })

    test('the join code stops resolving once the lobby is torn down by game load', async () => {
      const { id } = await createLobby(host, 'Listed lobby', 'listed')
      await joinLobby(joiner, id)
      const code = getLobbyJoinCode(id)!

      vi.useFakeTimers()
      lobbyService.startCountdown({ client: host.client })
      await vi.advanceTimersByTimeAsync(5000)

      expect(getLobbyJoinCode(id)).toBeUndefined()
      expect(getLobbyIdByJoinCode(code)).toBeUndefined()
    })
  })

  describe('game config', () => {
    /** Runs the countdown started by `startCountdown` to completion, letting the game load begin. */
    async function runCountdown(sockets: Sockets) {
      vi.useFakeTimers()
      lobbyService.startCountdown({ client: sockets.client })
      await vi.advanceTimersByTimeAsync(5000)
    }

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
})
