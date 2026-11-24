import { NydusServer } from 'nydus'
import { beforeEach, describe, expect, test } from 'vitest'
import { makeSbLobbyId } from '../../../common/lobbies/sb-lobby-id'
import {
  FriendActivityLobby,
  FriendActivityStatus,
  FriendActivityStatusUpdateEvent,
} from '../../../common/users/relationships'
import { makeSbUserId } from '../../../common/users/sb-user-id'
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
  NydusConnector,
} from '../websockets/testing/websockets'
import { TypedPublisher } from '../websockets/typed-publisher'
import { GameplayActivityRegistry } from './gameplay-activity-registry'

const USER = makeSbUserId(1)
const GAME_ID = 'game-1'
const LOBBY: FriendActivityLobby = { id: makeSbLobbyId('lobby-1'), name: 'Lobby One' }

describe('games/gameplay-activity-registry', () => {
  let nydus: NydusServer
  let fakeNydus: FakeNydusServer
  let activityStatusService: ActivityStatusService
  let registry: GameplayActivityRegistry
  let client: ClientSocketsGroup

  beforeEach(() => {
    nydus = createFakeNydusServer()
    fakeNydus = nydus as unknown as FakeNydusServer
    const sessionLookup = new RequestSessionLookup()
    const clientSocketsManager = new ClientSocketsManager(nydus, sessionLookup)
    const userSocketsManager = new UserSocketsManager(nydus, sessionLookup, async () => {})
    const clock = new FakeClock()
    clock.autoRunTimeouts = false

    activityStatusService = new ActivityStatusService(
      new TypedPublisher(nydus),
      userSocketsManager,
      clientSocketsManager,
      clock,
    )
    registry = new GameplayActivityRegistry(activityStatusService)

    const connector = new NydusConnector(nydus, sessionLookup)
    connector.connectClient({ id: USER, name: 'user', created: 0 }, 'one')
    client = clientSocketsManager.getById(USER, 'one')!
    clearTestLogs(nydus)
  })

  function publishedEvents(): FriendActivityStatusUpdateEvent[] {
    return fakeNydus.publish.mock.calls
      .filter(([path]) => path === getFriendActivityStatusPath(USER))
      .map(([, data]) => data)
  }

  test('reapplying a lobby activity after a game publishes the lobby again', () => {
    registry.registerActiveClient(USER, client, {
      status: FriendActivityStatus.InLobby,
      lobby: LOBBY,
    })
    activityStatusService.setInGame(USER, GAME_ID, client)
    activityStatusService.clearInGame(USER, GAME_ID)
    clearTestLogs(nydus)

    registry.reapplyStatus(USER)

    expect(publishedEvents()).toEqual([
      { userId: USER, status: FriendActivityStatus.InLobby, lobby: LOBBY },
    ])
  })

  test('a lobby update is published to a user in that lobby', () => {
    registry.registerActiveClient(USER, client, {
      status: FriendActivityStatus.InLobby,
      lobby: LOBBY,
    })
    clearTestLogs(nydus)

    registry.updateLobby(USER, { id: LOBBY.id, name: 'Renamed' })

    expect(publishedEvents()).toEqual([
      {
        userId: USER,
        status: FriendActivityStatus.InLobby,
        lobby: { id: LOBBY.id, name: 'Renamed' },
      },
    ])
  })

  test('a lobby update during a game is kept for when the user is back in the lobby', () => {
    registry.registerActiveClient(USER, client, {
      status: FriendActivityStatus.InLobby,
      lobby: LOBBY,
    })
    activityStatusService.setInGame(USER, GAME_ID, client)
    clearTestLogs(nydus)

    registry.updateLobby(USER, { id: LOBBY.id, name: 'Renamed' })

    expect(activityStatusService.getStatus(USER)).toBe(FriendActivityStatus.InGame)
    expect(publishedEvents()).toEqual([])

    registry.reapplyStatus(USER)

    expect(publishedEvents()).toEqual([
      {
        userId: USER,
        status: FriendActivityStatus.InLobby,
        lobby: { id: LOBBY.id, name: 'Renamed' },
      },
    ])
  })

  test('a lobby update for a different lobby or a queue activity is a no-op', () => {
    registry.registerActiveClient(USER, client, { status: FriendActivityStatus.InQueue })
    registry.updateLobby(USER, { id: LOBBY.id, name: 'Renamed' })
    registry.unregisterClientForUser(USER)

    registry.registerActiveClient(USER, client, {
      status: FriendActivityStatus.InLobby,
      lobby: LOBBY,
    })
    clearTestLogs(nydus)
    registry.updateLobby(USER, { id: makeSbLobbyId('lobby-2'), name: 'Renamed' })
    registry.reapplyStatus(USER)

    expect(publishedEvents()).toEqual([])
    expect(activityStatusService.getStatusEvent(USER)).toEqual({
      userId: USER,
      status: FriendActivityStatus.InLobby,
      lobby: LOBBY,
    })
  })

  test('rebinding keeps the lobby the user is registered in', () => {
    registry.registerActiveClient(USER, client, {
      status: FriendActivityStatus.InLobby,
      lobby: LOBBY,
    })
    activityStatusService.setInGame(USER, GAME_ID, client)
    registry.rebindClient(USER, client)
    activityStatusService.clearInGame(USER, GAME_ID)
    clearTestLogs(nydus)

    registry.reapplyStatus(USER)

    expect(publishedEvents()).toEqual([
      { userId: USER, status: FriendActivityStatus.InLobby, lobby: LOBBY },
    ])
  })

  test('unregistering a lobby activity publishes the user without a lobby', () => {
    registry.registerActiveClient(USER, client, {
      status: FriendActivityStatus.InLobby,
      lobby: LOBBY,
    })
    clearTestLogs(nydus)

    registry.unregisterClientForUser(USER)

    expect(publishedEvents()).toEqual([{ userId: USER, status: FriendActivityStatus.Online }])
  })
})
