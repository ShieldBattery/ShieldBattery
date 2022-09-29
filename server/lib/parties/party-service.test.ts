import { NydusServer } from 'nydus'
import {
  MatchmakingPreferences,
  MatchmakingServiceErrorCode,
  MatchmakingType,
} from '../../../common/matchmaking'
import { NotificationType } from '../../../common/notifications'
import { asMockedFunction } from '../../../common/testing/mocks'
import { makeSbUserId, SbUser, SbUserId } from '../../../common/users/sb-user'
import { GameplayActivityRegistry } from '../games/gameplay-activity-registry'
import { MatchmakingServiceError } from '../matchmaking/matchmaking-service-error'
import NotificationService from '../notifications/notification-service'
import { createFakeNotificationService } from '../notifications/testing/notification-service'
import { FakeClock } from '../time/testing/fake-clock'
import { findUsersByIdAsMap, findUsersByName } from '../users/user-model'
import { RequestSessionLookup } from '../websockets/session-lookup'
import { ClientSocketsManager } from '../websockets/socket-groups'
import {
  clearTestLogs,
  createFakeNydusServer,
  InspectableNydusClient,
  NydusConnector,
} from '../websockets/testing/websockets'
import { TypedPublisher } from '../websockets/typed-publisher'
import PartyService, { getPartyPath, PartyRecord, toPartyJson } from './party-service'

jest.mock('../users/user-model', () => ({
  findUsersByName: jest.fn(),
  findUsersByIdAsMap: jest.fn(),
}))

const findUsersByNameMock = asMockedFunction(findUsersByName)
const findUsersByIdAsMapMock = asMockedFunction(findUsersByIdAsMap)

function createMatchmakingService(matchmakerErrorQueue: Error[]) {
  return {
    findAsParty: jest.fn(async () => {
      if (matchmakerErrorQueue.length) {
        throw matchmakerErrorQueue.shift()
      }
    }),
    registerPartyLeave: jest.fn(),
  }
}

function createUserRelationshipService() {
  return {
    isUserBlockedBy: jest.fn(async () => false),
  }
}

describe('parties/party-service', () => {
  const user1: SbUser = { id: makeSbUserId(1), name: 'pachi' }
  const user2: SbUser = { id: makeSbUserId(2), name: 'harem' }
  const user3: SbUser = { id: makeSbUserId(3), name: 'intrigue' }
  const user4: SbUser = { id: makeSbUserId(4), name: 'tec27' }
  const user5: SbUser = { id: makeSbUserId(5), name: 'heyoka' }
  const user6: SbUser = { id: makeSbUserId(6), name: 'hot_bid' }
  const user7: SbUser = { id: makeSbUserId(7), name: 'royo' }
  const user8: SbUser = { id: makeSbUserId(8), name: 'riptide' }
  const user9: SbUser = { id: makeSbUserId(9), name: 'manifesto7' }
  const offlineUser: SbUser = { id: makeSbUserId(10), name: 'tt1' }
  const webUser: SbUser = { id: makeSbUserId(11), name: 'nyoken' }

  const USER1_CLIENT_ID = 'USER1_CLIENT_ID'
  const USER2_CLIENT_ID = 'USER2_CLIENT_ID'
  const USER3_CLIENT_ID = 'USER3_CLIENT_ID'
  const USER4_CLIENT_ID = 'USER4_CLIENT_ID'
  const USER5_CLIENT_ID = 'USER5_CLIENT_ID'
  const USER6_CLIENT_ID = 'USER6_CLIENT_ID'
  const USER7_CLIENT_ID = 'USER7_CLIENT_ID'
  const USER8_CLIENT_ID = 'USER8_CLIENT_ID'
  const USER9_CLIENT_ID = 'USER9_CLIENT_ID'
  const WEB_USER_CLIENT_ID = 'WEB_USER_CLIENT_ID'

  let client1: InspectableNydusClient
  let client2: InspectableNydusClient
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let client3: InspectableNydusClient
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let client4: InspectableNydusClient
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let client5: InspectableNydusClient
  let client6: InspectableNydusClient
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let client7: InspectableNydusClient
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let client8: InspectableNydusClient
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let client9: InspectableNydusClient
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let webClient: InspectableNydusClient

  let nydus: NydusServer
  let partyService: PartyService
  let connector: NydusConnector
  let notificationService: NotificationService
  let clock: FakeClock

  const matchmakerErrorQueue: Error[] = []
  // Basic implementation that throws any queued errors, otherwise resolves
  let fakeMatchmakingService = createMatchmakingService(matchmakerErrorQueue)
  let gameplayActivityRegistry: GameplayActivityRegistry
  let userRelationshipService = createUserRelationshipService()

  beforeEach(() => {
    nydus = createFakeNydusServer()
    const sessionLookup = new RequestSessionLookup()
    const clientSocketsManager = new ClientSocketsManager(nydus, sessionLookup)
    const publisher = new TypedPublisher(nydus)
    notificationService = createFakeNotificationService()
    clock = new FakeClock()
    clock.setCurrentTime(Number(new Date('2022-08-31T00:00:00.000Z')))
    gameplayActivityRegistry = new GameplayActivityRegistry()

    matchmakerErrorQueue.length = 0
    fakeMatchmakingService = createMatchmakingService(matchmakerErrorQueue)
    userRelationshipService = createUserRelationshipService()

    partyService = new PartyService(
      publisher,
      clientSocketsManager,
      notificationService,
      clock,
      gameplayActivityRegistry,
      fakeMatchmakingService as any,
      userRelationshipService as any,
    )
    connector = new NydusConnector(nydus, sessionLookup)

    client1 = connector.connectClient(user1, USER1_CLIENT_ID)
    client2 = connector.connectClient(user2, USER2_CLIENT_ID)
    client3 = connector.connectClient(user3, USER3_CLIENT_ID)
    client4 = connector.connectClient(user4, USER4_CLIENT_ID)
    client5 = connector.connectClient(user5, USER5_CLIENT_ID)
    client6 = connector.connectClient(user6, USER6_CLIENT_ID)
    client7 = connector.connectClient(user7, USER7_CLIENT_ID)
    client8 = connector.connectClient(user8, USER8_CLIENT_ID)
    client9 = connector.connectClient(user9, USER9_CLIENT_ID)
    webClient = connector.connectClient(webUser, WEB_USER_CLIENT_ID, 'web')

    clearTestLogs(nydus)
    findUsersByNameMock.mockClear()
    findUsersByIdAsMapMock.mockClear()
    findUsersByIdAsMapMock.mockResolvedValue(new Map())
  })

  describe('invite', () => {
    let leader: SbUser
    let party: PartyRecord

    test('should throw if inviting yourself', async () => {
      await expect(
        partyService.invite(user2.id, USER2_CLIENT_ID, user2),
      ).rejects.toThrowErrorMatchingInlineSnapshot(`"Can't invite yourself to the party"`)
    })

    describe('when party exists', () => {
      beforeEach(async () => {
        leader = user1
        party = await partyService.invite(leader.id, USER1_CLIENT_ID, user2)
        await partyService.acceptInvite(party.id, user2, USER2_CLIENT_ID)
      })

      test('should throw if invited by non-leader', async () => {
        await expect(
          partyService.invite(user2.id, USER2_CLIENT_ID, user3),
        ).rejects.toThrowErrorMatchingInlineSnapshot(`"Only party leader can invite people"`)
      })

      test('should not throw if invite already exists', async () => {
        await partyService.invite(leader.id, USER1_CLIENT_ID, user3)

        await expect(partyService.invite(leader.id, USER1_CLIENT_ID, user3)).resolves.not.toThrow()
      })

      test('should throw if invited user is already in the party', async () => {
        await partyService.invite(leader.id, USER1_CLIENT_ID, user3)
        await partyService.acceptInvite(party.id, user3, USER3_CLIENT_ID)

        await expect(
          partyService.invite(leader.id, USER1_CLIENT_ID, user3),
        ).rejects.toThrowErrorMatchingInlineSnapshot(
          `"This user is already a member of this party"`,
        )
      })

      test('should update the party record', async () => {
        party = await partyService.invite(leader.id, USER1_CLIENT_ID, user3)

        expect(party.invites).toMatchObject(new Set([user3.id]))
      })

      test('should publish "invite" message to the party path', async () => {
        party = await partyService.invite(leader.id, USER1_CLIENT_ID, user3)

        expect(nydus.publish).toHaveBeenCalledWith(getPartyPath(party.id), {
          type: 'invite',
          invitedUser: user3.id,
          time: clock.now(),
          userInfo: {
            id: user3.id,
            name: user3.name,
          },
        })
      })

      test('should throw if the user has blocked the leader', async () => {
        asMockedFunction(userRelationshipService.isUserBlockedBy).mockResolvedValue(true)
        await expect(
          partyService.invite(user1.id, USER1_CLIENT_ID, user2),
        ).rejects.toThrowErrorMatchingInlineSnapshot(`"This user has blocked you"`)
      })
    })

    describe("when party doesn't exist", () => {
      beforeEach(() => {
        leader = user1
      })

      test('should create a party record', async () => {
        party = await partyService.invite(leader.id, USER1_CLIENT_ID, user2)
        party = await partyService.invite(leader.id, USER1_CLIENT_ID, user3)

        expect(party).toMatchObject({
          id: party.id,
          invites: new Set([user2.id, user3.id]),
          members: new Set([leader.id]),
          leader: leader.id,
        })
      })

      test('should subscribe leader to the party path', async () => {
        findUsersByIdAsMapMock.mockResolvedValue(
          new Map([
            [user2.id, user2],
            [leader.id, leader],
          ]),
        )

        party = await partyService.invite(leader.id, USER1_CLIENT_ID, user2)
        party = await partyService.invite(leader.id, USER1_CLIENT_ID, user3)

        expect(client1.publish).toHaveBeenCalledWith(getPartyPath(party.id), {
          type: 'init',
          party: {
            id: party.id,
            // `init` event for the leader is only emitted when the party doesn't exist and the
            // first user is being invited.
            invites: [user2.id],
            members: [leader.id],
            leader: leader.id,
          },
          time: clock.now(),
          userInfos: [
            { id: user2.id, name: user2.name },
            { id: leader.id, name: leader.name },
          ],
        })
      })
    })

    test('should create the invite notification', async () => {
      leader = user1
      party = await partyService.invite(leader.id, USER1_CLIENT_ID, user2)

      expect(notificationService.addNotification).toHaveBeenCalledWith({
        userId: user2.id,
        data: {
          type: NotificationType.PartyInvite,
          from: leader.id,
          partyId: party.id,
        },
      })
    })

    test('should not create the invite notification if visible one already exists', async () => {
      notificationService.retrieveNotifications = jest.fn().mockResolvedValue([{ visible: true }])
      leader = user1
      party = await partyService.invite(leader.id, USER1_CLIENT_ID, user2)

      expect(notificationService.addNotification).not.toHaveBeenCalled()
    })

    test('should throw when notification creation fails', async () => {
      notificationService.addNotification = jest.fn().mockRejectedValue(undefined)

      await expect(
        partyService.invite(user1.id, USER1_CLIENT_ID, user2),
      ).rejects.toThrowErrorMatchingInlineSnapshot(`"Error creating the notification"`)
    })

    test('should invite an offline user', async () => {
      leader = user1
      party = await partyService.invite(leader.id, USER1_CLIENT_ID, offlineUser)

      expect(party.invites).toMatchObject(new Set([offlineUser.id]))
    })
  })

  describe('decline', () => {
    let party: PartyRecord

    beforeEach(async () => {
      party = await partyService.invite(user1.id, USER1_CLIENT_ID, user2)
      party = await partyService.invite(user1.id, USER1_CLIENT_ID, user3)
    })

    test('should clear the invite notification', async () => {
      const notificationId = 'NOTIFICATION_ID'
      asMockedFunction(notificationService.retrieveNotifications).mockResolvedValueOnce([
        {
          userId: user2.id,
          id: notificationId,
          data: { type: NotificationType.PartyInvite, from: party.leader, partyId: party.id },
          read: false,
          visible: true,
          createdAt: new Date(clock.now()),
        },
      ])

      // This function is implicitly using the promise in its implementation, so we need to await it
      // before we can test if the function below was called.
      await partyService.decline(party.id, user2.id)

      expect(notificationService.clearById).toHaveBeenCalledWith(user2.id, notificationId)
    })
  })

  describe('removeInvite', () => {
    let leader: SbUser
    let party: PartyRecord

    beforeEach(async () => {
      leader = user1
      party = await partyService.invite(leader.id, USER1_CLIENT_ID, user2)
      party = await partyService.invite(leader.id, USER1_CLIENT_ID, user3)
    })

    test('should clear the invite notification', async () => {
      const notificationId = 'NOTIFICATION_ID'
      asMockedFunction(notificationService.retrieveNotifications).mockResolvedValueOnce([
        {
          userId: user2.id,
          id: notificationId,
          data: { type: NotificationType.PartyInvite, from: party.leader, partyId: party.id },
          read: false,
          visible: true,
          createdAt: new Date(clock.now()),
        },
      ])

      await partyService.removeInvite(party.id, leader.id, user2.id)

      expect(notificationService.clearById).toHaveBeenCalledWith(user2.id, notificationId)
    })

    test('should throw if the party is not found', async () => {
      await expect(
        partyService.removeInvite('INVALID_PARTY_ID', leader.id, user2.id),
      ).rejects.toThrowErrorMatchingInlineSnapshot(`"Party not found or you're not in it"`)
    })

    test('should throw if not in party', async () => {
      await expect(
        partyService.removeInvite(party.id, user2.id, user4.id),
      ).rejects.toThrowErrorMatchingInlineSnapshot(`"Party not found or you're not in it"`)
    })

    test('should throw if removed by non-leader', async () => {
      await partyService.acceptInvite(party.id, user2, USER2_CLIENT_ID)

      await expect(
        partyService.removeInvite(party.id, user2.id, user3.id),
      ).rejects.toThrowErrorMatchingInlineSnapshot(
        `"Only party leaders can remove invites to other people"`,
      )
    })

    test('should throw if the user is not invited', async () => {
      await expect(
        partyService.removeInvite(party.id, leader.id, user4.id),
      ).rejects.toThrowErrorMatchingInlineSnapshot(
        `"Can't remove invite for a user that wasn't invited"`,
      )
    })

    test('should update the party record when removed', async () => {
      await partyService.removeInvite(party.id, leader.id, user2.id)

      expect(party.invites).toMatchObject(new Set([user3.id]))
    })

    test('should publish "uninvite" message to the party path', async () => {
      await partyService.removeInvite(party.id, leader.id, user2.id)

      expect(nydus.publish).toHaveBeenCalledWith(getPartyPath(party.id), {
        type: 'uninvite',
        target: user2.id,
        time: clock.now(),
      })
    })
  })

  describe('acceptInvite', () => {
    let leader: SbUser
    let party: PartyRecord

    beforeEach(async () => {
      leader = user1
      party = await partyService.invite(leader.id, USER1_CLIENT_ID, user2)
      party = await partyService.invite(leader.id, USER1_CLIENT_ID, user3)
    })

    test('should clear the invite notification', async () => {
      const notificationId = 'NOTIFICATION_ID'
      notificationService.retrieveNotifications = jest.fn().mockResolvedValue([
        {
          id: notificationId,
          data: { partyId: party.id },
        },
      ])

      // This function is implicitly using the promise in its implementation, so we need to await it
      // before we can test if the function below was called.
      await partyService.acceptInvite(party.id, user2, USER2_CLIENT_ID)

      expect(notificationService.clearById).toHaveBeenCalledWith(user2.id, notificationId)
    })

    test('should throw if the party is not found', async () => {
      await expect(
        partyService.acceptInvite('INVALID_PARTY_ID', user2, USER2_CLIENT_ID),
      ).rejects.toThrowErrorMatchingInlineSnapshot(`"Party not found or you're not invited to it"`)
    })

    test('should throw if the user is not invited', async () => {
      await expect(
        partyService.acceptInvite(party.id, user4, USER4_CLIENT_ID),
      ).rejects.toThrowErrorMatchingInlineSnapshot(`"Party not found or you're not invited to it"`)
    })

    test('should throw if the party is full', async () => {
      party = await partyService.invite(leader.id, USER1_CLIENT_ID, user4)
      party = await partyService.invite(leader.id, USER1_CLIENT_ID, user5)
      party = await partyService.invite(leader.id, USER1_CLIENT_ID, user6)
      party = await partyService.invite(leader.id, USER1_CLIENT_ID, user7)
      party = await partyService.invite(leader.id, USER1_CLIENT_ID, user8)
      await partyService.acceptInvite(party.id, user2, USER2_CLIENT_ID)
      await partyService.acceptInvite(party.id, user3, USER3_CLIENT_ID)
      await partyService.acceptInvite(party.id, user4, USER4_CLIENT_ID)
      await partyService.acceptInvite(party.id, user5, USER5_CLIENT_ID)
      await partyService.acceptInvite(party.id, user6, USER6_CLIENT_ID)
      await partyService.acceptInvite(party.id, user7, USER7_CLIENT_ID)
      await partyService.acceptInvite(party.id, user8, USER8_CLIENT_ID)

      party = await partyService.invite(leader.id, USER1_CLIENT_ID, user9)

      await expect(
        partyService.acceptInvite(party.id, user9, USER9_CLIENT_ID),
      ).rejects.toThrowErrorMatchingInlineSnapshot(`"Party is full"`)
    })

    test('should throw if accepting on web client', async () => {
      party = await partyService.invite(leader.id, USER1_CLIENT_ID, webUser)

      await expect(
        partyService.acceptInvite(party.id, webUser, WEB_USER_CLIENT_ID),
      ).rejects.toThrowErrorMatchingInlineSnapshot(`"Invalid client"`)
    })

    test('should update the party record', async () => {
      await partyService.acceptInvite(party.id, user2, USER2_CLIENT_ID)

      expect(party.invites).toMatchObject(new Set([user3.id]))
      expect(party.members).toMatchObject(new Set([leader.id, user2.id]))
    })

    test('should publish "join" message to the party path', async () => {
      await partyService.acceptInvite(party.id, user2, USER2_CLIENT_ID)

      // TODO(2Pac): Test the order of this call? This should probably be ensured that it's called
      // before subscribing the user to the party path.
      expect(nydus.publish).toHaveBeenCalledWith(getPartyPath(party.id), {
        type: 'join',
        user: user2.id,
        time: clock.now(),
        userInfo: user2,
      })
    })

    test('should subscribe user to the party path', async () => {
      findUsersByIdAsMapMock.mockResolvedValue(
        new Map([
          [user3.id, user3],
          [leader.id, leader],
          [user2.id, user2],
        ]),
      )

      await partyService.acceptInvite(party.id, user2, USER2_CLIENT_ID)
      // TODO(tec27): Add something to FakeNydusServer to resolve when all current subscription
      // promises are complete?
      await new Promise(resolve => setTimeout(resolve, 20))

      expect(client2.publish).toHaveBeenCalledWith(getPartyPath(party.id), {
        type: 'init',
        party: toPartyJson(party),
        time: clock.now(),
        userInfos: [
          { id: user3.id, name: user3.name },
          { id: leader.id, name: leader.name },
          { id: user2.id, name: user2.name },
        ],
      })
    })

    describe('when user was already in a party', () => {
      let oldLeader: SbUser
      let oldParty: PartyRecord
      let newLeader: SbUser
      let newParty: PartyRecord

      beforeEach(async () => {
        oldLeader = user4
        oldParty = await partyService.invite(oldLeader.id, USER4_CLIENT_ID, user6)
        await partyService.acceptInvite(oldParty.id, user6, USER6_CLIENT_ID)

        newLeader = user5
        newParty = await partyService.invite(newLeader.id, USER5_CLIENT_ID, user6)
      })

      test('should remove the user from the old party', async () => {
        await partyService.acceptInvite(newParty.id, user6, USER6_CLIENT_ID)

        expect(oldParty.members).toMatchObject(new Set([oldLeader.id]))
      })

      test('should remove the user from the new party on disconnect', async () => {
        await partyService.acceptInvite(newParty.id, user6, USER6_CLIENT_ID)
        client6.disconnect()

        expect(newParty.members).toMatchObject(new Set([newLeader.id]))
      })

      test('should publish "leave" message to the old party path', async () => {
        await partyService.acceptInvite(newParty.id, user6, USER6_CLIENT_ID)

        expect(nydus.publish).toHaveBeenCalledWith(getPartyPath(oldParty.id), {
          type: 'leave',
          user: user6.id,
          time: clock.now(),
        })
      })
    })
  })

  describe('leaveParty', () => {
    let leader: SbUser
    let party: PartyRecord

    beforeEach(async () => {
      leader = user1
      party = await partyService.invite(leader.id, USER1_CLIENT_ID, user2)
      partyService.acceptInvite(party.id, user2, USER2_CLIENT_ID)
    })

    test('should throw if the party is not found', () => {
      expect(() =>
        partyService.leaveParty('INVALID_PARTY_ID', user2.id, USER2_CLIENT_ID),
      ).toThrowErrorMatchingInlineSnapshot(`"Party not found or you're not in it"`)
    })

    test('should throw if the user is not in party', () => {
      expect(() =>
        partyService.leaveParty(party.id, user3.id, USER3_CLIENT_ID),
      ).toThrowErrorMatchingInlineSnapshot(`"Party not found or you're not in it"`)
    })

    test('should throw if the client could not be found', () => {
      expect(() =>
        partyService.leaveParty(party.id, user2.id, 'UNKNOWN_CLIENT_ID'),
      ).toThrowErrorMatchingInlineSnapshot(`"Client could not be found"`)
    })

    test('should update the party record', () => {
      partyService.leaveParty(party.id, user2.id, USER2_CLIENT_ID)

      expect(party.members).toMatchObject(new Set([leader.id]))
    })

    test('should publish "leave" message to the party path', () => {
      partyService.leaveParty(party.id, user2.id, USER2_CLIENT_ID)

      // TODO(2Pac): Test the order of this call? This should probably be ensured that it's called
      // before unsubscribing the user from the party path.
      expect(nydus.publish).toHaveBeenCalledWith(getPartyPath(party.id), {
        type: 'leave',
        user: user2.id,
        time: clock.now(),
      })
    })

    test('should unsubscribe user from the party path', () => {
      partyService.leaveParty(party.id, user2.id, USER2_CLIENT_ID)

      expect(client2.unsubscribe).toHaveBeenCalledWith(getPartyPath(party.id))
    })

    test('should assign new leader when old leader leaves', () => {
      partyService.leaveParty(party.id, leader.id, USER1_CLIENT_ID)

      expect(party.leader).toBe(user2.id)
    })

    test('should publish "leaderChange" message to the party path when leader leaves', () => {
      partyService.leaveParty(party.id, leader.id, USER1_CLIENT_ID)

      expect(nydus.publish).toHaveBeenCalledWith(getPartyPath(party.id), {
        type: 'leaderChange',
        leader: user2.id,
        time: clock.now(),
      })
    })
  })

  describe('sendChatMessage', () => {
    let leader: SbUser
    let party: PartyRecord

    beforeEach(async () => {
      leader = user1
      party = await partyService.invite(leader.id, USER1_CLIENT_ID, user2)
      partyService.acceptInvite(party.id, user2, USER2_CLIENT_ID)
    })

    test('should throw if the party is not found', async () => {
      await expect(() =>
        partyService.sendChatMessage('INVALID_PARTY_ID', user2, 'Hello World!'),
      ).rejects.toThrowErrorMatchingInlineSnapshot(`"Party not found or you're not in it"`)
    })

    test('should throw if the user is not in party', async () => {
      await expect(() =>
        partyService.sendChatMessage(party.id, user3, 'Hello World!'),
      ).rejects.toThrowErrorMatchingInlineSnapshot(`"Party not found or you're not in it"`)
    })

    test('should publish "chatMessage" event to the party path', async () => {
      findUsersByNameMock.mockResolvedValue(new Map())

      await partyService.sendChatMessage(party.id, user2, 'Hello World!')

      expect(nydus.publish).toHaveBeenCalledWith(getPartyPath(party.id), {
        type: 'chatMessage',
        message: {
          partyId: party.id,
          user: user2,
          time: clock.now(),
          text: 'Hello World!',
        },
        mentions: [],
      })
    })

    test('should process the user mentions in chat message', async () => {
      findUsersByNameMock.mockResolvedValue(
        new Map([['test', { id: 123 as SbUserId, name: 'test' }]]),
      )

      await partyService.sendChatMessage(party.id, user2, 'Hello @test and @non-existing')

      expect(nydus.publish).toHaveBeenCalledWith(getPartyPath(party.id), {
        type: 'chatMessage',
        message: {
          partyId: party.id,
          user: user2,
          time: clock.now(),
          text: 'Hello <@123> and @non-existing',
        },
        mentions: [{ id: 123, name: 'test' }],
      })
    })

    test('should process the user mentions with non-matching casing in chat message', async () => {
      findUsersByNameMock.mockResolvedValue(
        new Map([['test', { id: 123 as SbUserId, name: 'test' }]]),
      )

      await partyService.sendChatMessage(party.id, user2, 'Hello @TEST and @TeSt')

      expect(nydus.publish).toHaveBeenCalledWith(getPartyPath(party.id), {
        type: 'chatMessage',
        message: {
          partyId: party.id,
          user: user2,
          time: clock.now(),
          text: 'Hello <@123> and <@123>',
        },
        mentions: [{ id: 123, name: 'test' }],
      })
    })
  })

  describe('kickPlayer', () => {
    let leader: SbUser
    let party: PartyRecord

    beforeEach(async () => {
      leader = user1
      party = await partyService.invite(leader.id, USER1_CLIENT_ID, user2)
      party = await partyService.invite(leader.id, USER1_CLIENT_ID, user3)
      partyService.acceptInvite(party.id, user2, USER2_CLIENT_ID)
      partyService.acceptInvite(party.id, user3, USER3_CLIENT_ID)
    })

    test('should throw if the party is not found', () => {
      expect(() =>
        partyService.kickPlayer('INVALID_PARTY_ID', leader.id, user2.id),
      ).toThrowErrorMatchingInlineSnapshot(`"Party not found or you're not in it"`)
    })

    test('should throw if not in party', () => {
      expect(() =>
        partyService.kickPlayer(party.id, user4.id, user3.id),
      ).toThrowErrorMatchingInlineSnapshot(`"Party not found or you're not in it"`)
    })

    test('should throw if kicked by non-leader', () => {
      expect(() =>
        partyService.kickPlayer(party.id, user2.id, user3.id),
      ).toThrowErrorMatchingInlineSnapshot(`"Only party leaders can kick other people"`)
    })

    test('should throw if the user is not in party', () => {
      expect(() =>
        partyService.kickPlayer(party.id, leader.id, user4.id),
      ).toThrowErrorMatchingInlineSnapshot(`"Can't kick player who is not in your party"`)
    })

    test('should throw if trying to kick yourself', () => {
      expect(() =>
        partyService.kickPlayer(party.id, leader.id, leader.id),
      ).toThrowErrorMatchingInlineSnapshot(`"Can't kick yourself"`)
    })

    test('should update the party record when kicked', () => {
      partyService.kickPlayer(party.id, leader.id, user2.id)

      expect(party.members).toMatchObject(new Set([leader.id, user3.id]))
    })

    test('should publish "kick" message to the party path', () => {
      partyService.kickPlayer(party.id, leader.id, user2.id)

      expect(nydus.publish).toHaveBeenCalledWith(getPartyPath(party.id), {
        type: 'kick',
        target: user2.id,
        time: clock.now(),
      })
    })

    test('should unsubscribe kicked user from the party path', () => {
      partyService.kickPlayer(party.id, leader.id, user2.id)

      expect(client2.unsubscribe).toHaveBeenCalledWith(getPartyPath(party.id))
    })
  })

  describe('changeLeader', () => {
    let leader: SbUser
    let party: PartyRecord

    beforeEach(async () => {
      leader = user1
      party = await partyService.invite(leader.id, USER1_CLIENT_ID, user2)
      party = await partyService.invite(leader.id, USER1_CLIENT_ID, user3)
      partyService.acceptInvite(party.id, user2, USER2_CLIENT_ID)
      partyService.acceptInvite(party.id, user3, USER3_CLIENT_ID)
    })

    test('should throw if the party is not found', () => {
      expect(() =>
        partyService.changeLeader('INVALID_PARTY_ID', leader.id, user2.id),
      ).toThrowErrorMatchingInlineSnapshot(`"Party not found or you're not in it"`)
    })

    test('should throw if not in party', () => {
      expect(() =>
        partyService.changeLeader(party.id, user4.id, user3.id),
      ).toThrowErrorMatchingInlineSnapshot(`"Party not found or you're not in it"`)
    })

    test('should throw if non-leader tries to change leaders', () => {
      expect(() =>
        partyService.changeLeader(party.id, user2.id, user3.id),
      ).toThrowErrorMatchingInlineSnapshot(`"Only party leaders can change leaders"`)
    })

    test('should throw if the user is not in party', () => {
      expect(() =>
        partyService.changeLeader(party.id, leader.id, user4.id),
      ).toThrowErrorMatchingInlineSnapshot(`"Only party members can be made leader"`)
    })

    test('should throw if trying to make yourself a leader', () => {
      expect(() =>
        partyService.changeLeader(party.id, leader.id, leader.id),
      ).toThrowErrorMatchingInlineSnapshot(`"You're already a leader"`)
    })

    test('should update the party record when changing leaders', () => {
      partyService.changeLeader(party.id, leader.id, user2.id)

      expect(party.leader).toEqual(user2.id)
    })

    test('should publish "leaderChange" message to the party path', () => {
      partyService.changeLeader(party.id, leader.id, user2.id)

      expect(nydus.publish).toHaveBeenCalledWith(getPartyPath(party.id), {
        type: 'leaderChange',
        leader: user2.id,
        time: clock.now(),
      })
    })
  })

  describe('matchmaking', () => {
    let leader: SbUser
    let party: PartyRecord
    let preferences: MatchmakingPreferences

    beforeEach(async () => {
      leader = user1
      preferences = {
        userId: leader.id,
        matchmakingType: MatchmakingType.Match2v2,
        mapPoolId: 1,
        mapSelections: [],
        data: {},
        race: 'p',
      }

      party = await partyService.invite(leader.id, USER1_CLIENT_ID, user2)
      await partyService.invite(leader.id, USER1_CLIENT_ID, user3)
      partyService.acceptInvite(party.id, user2, USER2_CLIENT_ID)
    })

    test('should throw if the party is not found', async () => {
      await expect(
        partyService.findMatch('INVALID_PARTY_ID', leader.id, [[1, 'foo']], preferences),
      ).rejects.toThrowErrorMatchingInlineSnapshot(`"Party not found or you're not in it"`)

      expect(gameplayActivityRegistry.getClientForUser(leader.id)).toBeUndefined()
    })

    test('should throw if not in party', async () => {
      await expect(() =>
        partyService.findMatch(party.id, user4.id, [[1, 'foo']], preferences),
      ).rejects.toThrowErrorMatchingInlineSnapshot(`"Party not found or you're not in it"`)

      expect(gameplayActivityRegistry.getClientForUser(user4.id)).toBeUndefined()
    })

    test('should throw if non-leader tries to find match', async () => {
      await expect(() =>
        partyService.findMatch(party.id, user2.id, [[1, 'foo']], preferences),
      ).rejects.toThrowErrorMatchingInlineSnapshot(`"Only party leaders can queue for matchmaking"`)

      expect(gameplayActivityRegistry.getClientForUser(user2.id)).toBeUndefined()
    })

    test('should throw if queueing for a smaller matchmaking type', async () => {
      preferences.matchmakingType = MatchmakingType.Match1v1
      await expect(() =>
        partyService.findMatch(party.id, leader.id, [[1, 'foo']], preferences),
      ).rejects.toThrowErrorMatchingInlineSnapshot(`"Party is too large for that matchmaking type"`)

      expect(gameplayActivityRegistry.getClientForUser(leader.id)).toBeUndefined()
    })

    // eslint-disable-next-line jest/no-commented-out-tests
    /*

    TODO(tec27): Uncomment this when we add 3v3, can't build this test with only 1v1/2v2

    test('should throw if queueing for a different matchmaking type', async () => {
      await partyService.findMatch(party.id, leader.id, preferences)

      preferences.matchmakingType = MatchmakingType.Match3v3
      await expect(() =>
        partyService.findMatch(party.id, leader.id, preferences),
      ).rejects.toThrowErrorMatchingInlineSnapshot(
        `"Party is already in the process of queueing for a different matchmaking type"`
      )
    })
    */

    test('should send out queue updates as players accept', async () => {
      await partyService.findMatch(party.id, leader.id, [[1, 'foo']], preferences)

      expect(nydus.publish).toHaveBeenCalledWith(
        getPartyPath(party.id),
        expect.objectContaining({
          type: 'queue',
          id: expect.toBeString(),
          matchmakingType: preferences.matchmakingType,
          accepted: [[leader.id, preferences.race]],
          unaccepted: [user2.id],
          time: clock.now(),
        }),
      )

      const queueId = party.partyQueueRequest!.id

      // TODO(tec27): Extend this test a bit when 3v3 is available
      partyService.acceptFindMatch(party.id, queueId, user2.id, [[1, 'bar']], 'z')
      await new Promise<void>(resolve => setTimeout(resolve, 20))

      expect(nydus.publish).toHaveBeenCalledWith(
        getPartyPath(party.id),
        expect.objectContaining({
          type: 'queueReady',
          id: queueId,
          queuedMembers: [
            [leader.id, preferences.race],
            [user2.id, 'z'],
          ],
          time: clock.now(),
        }),
      )
    })

    test('should cancel the queue if a player rejects the match', async () => {
      await partyService.findMatch(party.id, leader.id, [[1, 'foo']], preferences)
      const queueId = party.partyQueueRequest!.id

      partyService.rejectFindMatch(party.id, queueId, user2.id)
      await new Promise<void>(resolve => setTimeout(resolve, 20))

      expect(nydus.publish).toHaveBeenCalledWith(
        getPartyPath(party.id),
        expect.objectContaining({
          type: 'queueCancel',
          id: queueId,
          reason: { type: 'rejected', user: user2.id },
          time: clock.now(),
        }),
      )

      expect(gameplayActivityRegistry.getClientForUser(leader.id)).toBeUndefined()
      expect(gameplayActivityRegistry.getClientForUser(user2.id)).toBeUndefined()
    })

    test('should cancel the queue if a player leaves the party', async () => {
      await partyService.findMatch(party.id, leader.id, [[1, 'foo']], preferences)
      const queueId = party.partyQueueRequest!.id

      partyService.leaveParty(party.id, user2.id, USER2_CLIENT_ID)
      await new Promise<void>(resolve => setTimeout(resolve, 20))

      expect(nydus.publish).toHaveBeenCalledWith(
        getPartyPath(party.id),
        expect.objectContaining({
          type: 'queueCancel',
          id: queueId,
          reason: { type: 'userLeft', user: user2.id },
          time: clock.now(),
        }),
      )

      expect(gameplayActivityRegistry.getClientForUser(leader.id)).toBeUndefined()
      expect(gameplayActivityRegistry.getClientForUser(user2.id)).toBeUndefined()
    })

    test('should cancel the queue if a player is kicked from the party', async () => {
      await partyService.findMatch(party.id, leader.id, [[1, 'foo']], preferences)
      const queueId = party.partyQueueRequest!.id

      partyService.kickPlayer(party.id, leader.id, user2.id)
      await new Promise<void>(resolve => setTimeout(resolve, 20))

      expect(nydus.publish).toHaveBeenCalledWith(
        getPartyPath(party.id),
        expect.objectContaining({
          type: 'queueCancel',
          id: queueId,
          reason: { type: 'userLeft', user: user2.id },
          time: clock.now(),
        }),
      )

      expect(gameplayActivityRegistry.getClientForUser(leader.id)).toBeUndefined()
      expect(gameplayActivityRegistry.getClientForUser(user2.id)).toBeUndefined()
    })

    test('should cancel the queue if a player disconnects', async () => {
      await partyService.findMatch(party.id, leader.id, [[1, 'foo']], preferences)
      const queueId = party.partyQueueRequest!.id

      client1.disconnect()
      await new Promise<void>(resolve => setTimeout(resolve, 20))

      expect(nydus.publish).toHaveBeenCalledWith(
        getPartyPath(party.id),
        expect.objectContaining({
          type: 'queueCancel',
          id: queueId,
          reason: { type: 'userLeft', user: leader.id },
          time: clock.now(),
        }),
      )

      expect(gameplayActivityRegistry.getClientForUser(leader.id)).toBeUndefined()
      expect(gameplayActivityRegistry.getClientForUser(user2.id)).toBeUndefined()
    })

    test("shouldn't add newly joining players to the matchmaking process", async () => {
      await partyService.findMatch(party.id, leader.id, [[1, 'foo']], preferences)
      const queueId = party.partyQueueRequest!.id

      await partyService.acceptInvite(party.id, user3, USER3_CLIENT_ID)
      partyService.acceptFindMatch(party.id, queueId, user2.id, [[1, 'bar']], 'z')
      await new Promise<void>(resolve => setTimeout(resolve, 20))

      expect(fakeMatchmakingService.findAsParty).toHaveBeenCalledWith(
        expect.objectContaining({
          type: preferences.matchmakingType,
          users: new Map([
            [
              leader.id,
              { race: preferences.race, clientId: USER1_CLIENT_ID, identifiers: [[1, 'foo']] },
            ],
            [user2.id, { race: 'z', clientId: USER2_CLIENT_ID, identifiers: [[1, 'bar']] }],
          ]),
          partyId: party.id,
          leaderId: leader.id,
          leaderPreferences: {
            mapSelections: preferences.mapSelections,
            preferenceData: preferences.data,
          },
        }),
      )

      expect(nydus.publish).toHaveBeenCalledWith(
        getPartyPath(party.id),
        expect.objectContaining({
          type: 'queueReady',
          id: queueId,
          queuedMembers: [
            [leader.id, preferences.race],
            [user2.id, 'z'],
          ],
          time: clock.now(),
        }),
      )

      // We expect the matchmaking service would managed this at this point, so it should still be
      // registered
      expect(gameplayActivityRegistry.getClientForUser(leader.id)).toBeDefined()
      expect(gameplayActivityRegistry.getClientForUser(user2.id)).toBeDefined()
      // user 3 didn't get queued, so should still not be registered
      expect(gameplayActivityRegistry.getClientForUser(user3.id)).toBeUndefined()
    })

    test('should handle matchmaking becoming disabled', async () => {
      matchmakerErrorQueue.push(
        new MatchmakingServiceError(
          MatchmakingServiceErrorCode.MatchmakingDisabled,
          'Matchmaking is currently disabled',
        ),
      )

      await partyService.findMatch(party.id, leader.id, [[1, 'foo']], preferences)
      const queueId = party.partyQueueRequest!.id

      await partyService.acceptInvite(party.id, user3, USER3_CLIENT_ID)
      partyService.acceptFindMatch(party.id, queueId, user2.id, [[1, 'bar']], 'z')
      await new Promise<void>(resolve => setTimeout(resolve, 20))

      expect(fakeMatchmakingService.findAsParty).toHaveBeenCalledWith(
        expect.objectContaining({
          type: preferences.matchmakingType,
          users: new Map([
            [
              leader.id,
              { race: preferences.race, clientId: USER1_CLIENT_ID, identifiers: [[1, 'foo']] },
            ],
            [user2.id, { race: 'z', clientId: USER2_CLIENT_ID, identifiers: [[1, 'bar']] }],
          ]),
          partyId: party.id,
          leaderId: leader.id,
          leaderPreferences: {
            mapSelections: preferences.mapSelections,
            preferenceData: preferences.data,
          },
        }),
      )

      expect(nydus.publish).toHaveBeenCalledWith(
        getPartyPath(party.id),
        expect.objectContaining({
          type: 'queueCancel',
          id: queueId,
          reason: { type: 'matchmakingDisabled' },
          time: clock.now(),
        }),
      )

      expect(gameplayActivityRegistry.getClientForUser(leader.id)).toBeUndefined()
      expect(gameplayActivityRegistry.getClientForUser(user2.id)).toBeUndefined()
    })

    test('should notify matchmaking of players leaving party after queue', async () => {
      await partyService.findMatch(party.id, leader.id, [[1, 'foo']], preferences)
      const queueId = party.partyQueueRequest!.id

      partyService.acceptFindMatch(party.id, queueId, user2.id, [[1, 'bar']], 'z')
      await new Promise<void>(resolve => setTimeout(resolve, 20))

      expect(fakeMatchmakingService.findAsParty).toHaveBeenCalledWith(
        expect.objectContaining({
          type: preferences.matchmakingType,
          users: new Map([
            [
              leader.id,
              { race: preferences.race, clientId: USER1_CLIENT_ID, identifiers: [[1, 'foo']] },
            ],
            [user2.id, { race: 'z', clientId: USER2_CLIENT_ID, identifiers: [[1, 'bar']] }],
          ]),
          partyId: party.id,
          leaderId: leader.id,
          leaderPreferences: {
            mapSelections: preferences.mapSelections,
            preferenceData: preferences.data,
          },
        }),
      )

      partyService.leaveParty(party.id, user2.id, USER2_CLIENT_ID)
      expect(fakeMatchmakingService.registerPartyLeave).toHaveBeenCalledWith(user2.id, party.id)
    })
  })
})
