import { NydusServer } from 'nydus'
import { beforeEach, describe, expect, test } from 'vitest'
import { FriendActivityStatus } from '../../../common/users/relationships'
import { makeSbUserId, SbUserId } from '../../../common/users/sb-user-id'
import { FakeClock, StopCriteria } from '../time/testing/fake-clock'
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
import { ActivityStatusService, getFriendActivityStatusPath } from './activity-status-service'

const USER = makeSbUserId(1)
const GAME_ID = 'game-1'
const GRACE_MS = 60_000

describe('users/activity-status-service', () => {
  let nydus: NydusServer
  let fakeNydus: FakeNydusServer
  let clientSocketsManager: ClientSocketsManager
  let connector: NydusConnector
  let clock: FakeClock
  let activityStatusService: ActivityStatusService

  beforeEach(() => {
    nydus = createFakeNydusServer()
    fakeNydus = nydus as unknown as FakeNydusServer
    const sessionLookup = new RequestSessionLookup()
    clientSocketsManager = new ClientSocketsManager(nydus, sessionLookup)
    const userSocketsManager = new UserSocketsManager(nydus, sessionLookup, async () => {})
    const publisher = new TypedPublisher(nydus)

    clock = new FakeClock()
    clock.autoRunTimeouts = false
    clock.setCurrentTime(Number(new Date('2022-08-31T00:00:00.000Z')))

    activityStatusService = new ActivityStatusService(
      publisher,
      userSocketsManager,
      clientSocketsManager,
      clock,
    )
    connector = new NydusConnector(nydus, sessionLookup)
  })

  function connect(userId: SbUserId, clientId: string): InspectableNydusClient {
    return connector.connectClient({ id: userId, name: `user-${userId}`, created: 0 }, clientId)
  }

  function expectPublished(userId: SbUserId, status: FriendActivityStatus) {
    expect(fakeNydus.publish).toHaveBeenCalledWith(getFriendActivityStatusPath(userId), {
      userId,
      status,
    })
  }

  function expectNotPublished(userId: SbUserId) {
    expect(fakeNydus.publish).not.toHaveBeenCalledWith(
      getFriendActivityStatusPath(userId),
      expect.anything(),
    )
  }

  test('is offline for a user with no sockets', () => {
    expect(activityStatusService.getStatus(USER)).toBe(FriendActivityStatus.Offline)
  })

  test('is online for a connected user and publishes on connect', () => {
    connect(USER, 'one')

    expect(activityStatusService.getStatus(USER)).toBe(FriendActivityStatus.Online)
    expectPublished(USER, FriendActivityStatus.Online)
  })

  test('publishes offline when the last socket disconnects', () => {
    const client = connect(USER, 'one')
    clearTestLogs(nydus)

    client.disconnect()

    expect(activityStatusService.getStatus(USER)).toBe(FriendActivityStatus.Offline)
    expectPublished(USER, FriendActivityStatus.Offline)
  })

  test('publishes an activity when it is set, and only when it changes', () => {
    connect(USER, 'one')
    clearTestLogs(nydus)

    activityStatusService.setActivity(USER, FriendActivityStatus.InLobby)

    expect(activityStatusService.getStatus(USER)).toBe(FriendActivityStatus.InLobby)
    expectPublished(USER, FriendActivityStatus.InLobby)

    clearTestLogs(nydus)
    activityStatusService.setActivity(USER, FriendActivityStatus.InLobby)

    expectNotPublished(USER)
  })

  test('clearing an activity the user is not doing is a no-op', () => {
    connect(USER, 'one')
    activityStatusService.setActivity(USER, FriendActivityStatus.InQueue)
    clearTestLogs(nydus)

    activityStatusService.clearActivity(USER, FriendActivityStatus.InLobby)

    expect(activityStatusService.getStatus(USER)).toBe(FriendActivityStatus.InQueue)
    expectNotPublished(USER)

    activityStatusService.clearActivity(USER, FriendActivityStatus.InQueue)

    expect(activityStatusService.getStatus(USER)).toBe(FriendActivityStatus.Online)
    expectPublished(USER, FriendActivityStatus.Online)
  })

  test('clearing a lobby activity for an in-game user is a no-op', () => {
    connect(USER, 'one')
    activityStatusService.setActivity(USER, FriendActivityStatus.InLobby)
    activityStatusService.setInGame(USER, GAME_ID, clientSocketsManager.getById(USER, 'one')!)
    clearTestLogs(nydus)

    activityStatusService.clearActivity(USER, FriendActivityStatus.InLobby)

    expect(activityStatusService.getStatus(USER)).toBe(FriendActivityStatus.InGame)
    expectNotPublished(USER)
  })

  test('clearing the in-game state only works for the game being played', () => {
    connect(USER, 'one')
    activityStatusService.setInGame(USER, GAME_ID, clientSocketsManager.getById(USER, 'one')!)
    clearTestLogs(nydus)

    activityStatusService.clearInGame(USER, 'some-other-game')

    expect(activityStatusService.getStatus(USER)).toBe(FriendActivityStatus.InGame)
    expectNotPublished(USER)

    activityStatusService.clearInGame(USER, GAME_ID)

    expect(activityStatusService.getStatus(USER)).toBe(FriendActivityStatus.Online)
    expectPublished(USER, FriendActivityStatus.Online)
  })

  test('the in-game state outlives a short disconnect of the playing client', async () => {
    const playingClient = connect(USER, 'playing')
    connect(USER, 'other')
    activityStatusService.setInGame(USER, GAME_ID, clientSocketsManager.getById(USER, 'playing')!)

    playingClient.disconnect()
    clearTestLogs(nydus)

    expect(activityStatusService.getStatus(USER)).toBe(FriendActivityStatus.InGame)
    expectNotPublished(USER)

    await clock.runTimeoutsUntil({
      criteria: StopCriteria.TimeReached,
      timeMillis: clock.now() + GRACE_MS,
    })

    expect(activityStatusService.getStatus(USER)).toBe(FriendActivityStatus.Online)
    expectPublished(USER, FriendActivityStatus.Online)
  })

  test('the playing client reconnecting cancels the in-game grace period', async () => {
    const playingClient = connect(USER, 'playing')
    connect(USER, 'other')
    activityStatusService.setInGame(USER, GAME_ID, clientSocketsManager.getById(USER, 'playing')!)

    playingClient.disconnect()
    const reconnectedClient = connect(USER, 'playing')
    clearTestLogs(nydus)

    await clock.runTimeoutsUntil({ criteria: StopCriteria.EmptyQueue })

    expect(activityStatusService.getStatus(USER)).toBe(FriendActivityStatus.InGame)
    expectNotPublished(USER)

    // The grace period has to restart for the reconnected client, otherwise the user would be stuck
    // in the in-game state forever.
    reconnectedClient.disconnect()
    await clock.runTimeoutsUntil({ criteria: StopCriteria.EmptyQueue })

    expect(activityStatusService.getStatus(USER)).toBe(FriendActivityStatus.Online)
    expectPublished(USER, FriendActivityStatus.Online)
  })

  test('reconnecting after a full disconnect publishes the in-game state again', async () => {
    const client = connect(USER, 'playing')
    activityStatusService.setInGame(USER, GAME_ID, clientSocketsManager.getById(USER, 'playing')!)

    client.disconnect()
    expect(activityStatusService.getStatus(USER)).toBe(FriendActivityStatus.Offline)
    clearTestLogs(nydus)

    connect(USER, 'playing')

    expect(activityStatusService.getStatus(USER)).toBe(FriendActivityStatus.InGame)
    expectPublished(USER, FriendActivityStatus.InGame)

    await clock.runTimeoutsUntil({ criteria: StopCriteria.EmptyQueue })

    expect(activityStatusService.getStatus(USER)).toBe(FriendActivityStatus.InGame)
  })

  test('the in-game state is dropped if the user stays disconnected past the grace period', async () => {
    const client = connect(USER, 'playing')
    activityStatusService.setInGame(USER, GAME_ID, clientSocketsManager.getById(USER, 'playing')!)

    client.disconnect()
    await clock.runTimeoutsUntil({ criteria: StopCriteria.EmptyQueue })
    clearTestLogs(nydus)

    connect(USER, 'playing')

    expect(activityStatusService.getStatus(USER)).toBe(FriendActivityStatus.Online)
    expectPublished(USER, FriendActivityStatus.Online)
  })
})
