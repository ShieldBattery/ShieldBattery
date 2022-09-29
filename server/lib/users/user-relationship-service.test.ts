import { NydusServer } from 'nydus'
import { NotificationType } from '../../../common/notifications'
import { asMockedFunction } from '../../../common/testing/mocks'
import {
  FriendActivityStatus,
  MAX_BLOCKS,
  MAX_FRIENDS,
  UserRelationship,
  UserRelationshipKind,
  UserRelationshipSummary,
} from '../../../common/users/relationships'
import { makeSbUserId, SbUserId } from '../../../common/users/sb-user'
import NotificationService from '../notifications/notification-service'
import { createFakeNotificationService } from '../notifications/testing/notification-service'
import { FakeClock } from '../time/testing/fake-clock'
import { RequestSessionLookup } from '../websockets/session-lookup'
import { UserSocketsManager } from '../websockets/socket-groups'
import {
  clearTestLogs,
  createFakeNydusServer,
  InspectableNydusClient,
  NydusConnector,
} from '../websockets/testing/websockets'
import { TypedPublisher } from '../websockets/typed-publisher'
import {
  getFriendActivityStatusPath,
  getRelationshipsPath,
  UserRelationshipService,
} from './user-relationship-service'

function clearFakeDb() {
  ;(global as any).__TESTONLY_CLEAR_DB()
}

// TODO(tec27): These could really use some tests of their own tbh
jest.mock('./user-relationship-models', () => {
  const fakeDb = new Map<SbUserId, UserRelationshipSummary>()

  function createSummary(): UserRelationshipSummary {
    return {
      friends: [],
      incomingRequests: [],
      outgoingRequests: [],
      blocks: [],
    }
  }

  ;(global as any).__TESTONLY_CLEAR_DB = () => {
    fakeDb.clear()
  }

  // NOTE(tec27): We can't reference the actual import in this file here because this whole block
  // is going to be hoisted (and run before) all of that, so instead we do the import async-ly.
  // (Thankfully all the db functions are async anyway, so it works out)
  const userRelationshipTypePromise = import('../../../common/users/relationships').then(
    m => m.UserRelationshipKind,
  )

  return {
    getRelationshipSummaryForUser: jest.fn(async (userId: SbUserId) => {
      const value = fakeDb.get(userId)
      return {
        friends: [...(value?.friends ?? [])],
        incomingRequests: [...(value?.incomingRequests ?? [])],
        outgoingRequests: [...(value?.outgoingRequests ?? [])],
        blocks: [...(value?.blocks ?? [])],
      }
    }),

    countFriendsAndRequests: jest.fn(async (userId: SbUserId) => {
      const value = fakeDb.get(userId)
      return (value?.friends?.length ?? 0) + (value?.outgoingRequests?.length ?? 0)
    }),

    countBlocks: jest.fn(async (userId: SbUserId) => {
      const value = fakeDb.get(userId)
      return value?.blocks?.length ?? 0
    }),

    sendFriendRequest: jest.fn(async (fromId: SbUserId, toId: SbUserId, date: Date) => {
      const UserRelationshipType = await userRelationshipTypePromise

      const fromSummary = fakeDb.get(fromId) ?? createSummary()
      const toSummary = fakeDb.get(toId) ?? createSummary()

      const result: UserRelationship[] = []

      if (
        fromSummary.blocks.find(r => r.toId === toId) ||
        toSummary.blocks.find(r => r.toId === fromId)
      ) {
        // Someone has blocked the other, so no friend request can be sent
        const fromRelationship = fromSummary.blocks.find(r => r.toId === toId)
        const toRelationship = toSummary.blocks.find(r => r.toId === fromId)
        if (fromRelationship) {
          result.push(fromRelationship)
        }
        if (toRelationship) {
          result.push(toRelationship)
        }
      } else if (toSummary.outgoingRequests.find(r => r.toId === fromId)) {
        // The target user has already sent a friend request, so the friend request is accepted
        const request = toSummary.outgoingRequests.find(r => r.toId === fromId)!
        toSummary.outgoingRequests = toSummary.outgoingRequests.filter(r => r.toId !== fromId)
        const toRelationship = {
          fromId: request.fromId,
          toId: request.toId,
          kind: UserRelationshipType.Friend,
          createdAt: new Date(request.createdAt),
        }
        toSummary.friends.push(toRelationship)
        result.push(toRelationship)

        fromSummary.incomingRequests = fromSummary.incomingRequests.filter(r => r.fromId !== toId)
        const fromRelationship = {
          fromId,
          toId,
          kind: UserRelationshipType.Friend,
          createdAt: new Date(date),
        }
        fromSummary.friends.push(fromRelationship)
        result.push(fromRelationship)
      } else if (fromSummary.friends.find(r => r.toId === toId)) {
        // These users are already friends
        result.push(fromSummary.friends.find(r => r.toId === toId)!)
        result.push(toSummary.friends.find(r => r.fromId === fromId)!)
      } else if (fromSummary.outgoingRequests.find(r => r.toId === toId)) {
        // The user has already sent a friend request
        result.push(fromSummary.outgoingRequests.find(r => r.toId === toId)!)
        const toRelationship = toSummary.incomingRequests.find(r => r.fromId === fromId)!
        if (toRelationship) {
          result.push(toRelationship)
        }
      } else {
        // No relationship exists, so a friend request is sent
        const relationship = {
          fromId,
          toId,
          kind: UserRelationshipType.FriendRequest,
          createdAt: new Date(date),
        }
        fromSummary.outgoingRequests.push(relationship)
        toSummary.incomingRequests.push(relationship)
        result.push(relationship)
      }

      fakeDb.set(fromId, fromSummary)
      fakeDb.set(toId, toSummary)

      return result
    }),

    acceptFriendRequest: jest.fn(
      async (acceptingId: SbUserId, requestingId: SbUserId, date: Date) => {
        const UserRelationshipType = await userRelationshipTypePromise

        const acceptingSummary = fakeDb.get(acceptingId) ?? createSummary()
        const requestingSummary = fakeDb.get(requestingId) ?? createSummary()

        const result: UserRelationship[] = []

        if (acceptingSummary.friends.find(r => r.toId === requestingId)) {
          // These users are already friends
          result.push(acceptingSummary.friends.find(r => r.toId === requestingId)!)
          result.push(requestingSummary.friends.find(r => r.fromId === acceptingId)!)
        } else if (
          acceptingSummary.blocks.find(r => r.toId === requestingId) ||
          requestingSummary.blocks.find(r => r.fromId === acceptingId)
        ) {
          // Someone has blocked the other, so no friend request can be accepted
          const acceptingRelationship = acceptingSummary.blocks.find(r => r.toId === requestingId)
          const requestingRelationship = requestingSummary.blocks.find(
            r => r.fromId === acceptingId,
          )
          if (acceptingRelationship) {
            result.push(acceptingRelationship)
          }
          if (requestingRelationship) {
            result.push(requestingRelationship)
          }
        } else if (acceptingSummary.incomingRequests.find(r => r.fromId === requestingId)) {
          const request = acceptingSummary.incomingRequests.find(r => r.fromId === requestingId)!
          acceptingSummary.incomingRequests = acceptingSummary.incomingRequests.filter(
            r => r.fromId !== requestingId,
          )
          requestingSummary.outgoingRequests = requestingSummary.outgoingRequests.filter(
            r => r.toId !== acceptingId,
          )
          const acceptingRelationship = {
            fromId: acceptingId,
            toId: requestingId,
            kind: UserRelationshipType.Friend,
            createdAt: new Date(date),
          }
          const requestingRelationship = {
            fromId: requestingId,
            toId: acceptingId,
            kind: UserRelationshipType.Friend,
            createdAt: new Date(request.createdAt),
          }

          acceptingSummary.friends.push(acceptingRelationship)
          requestingSummary.friends.push(requestingRelationship)

          result.push(acceptingRelationship)
          result.push(requestingRelationship)
        } else {
          // No request exists (no-op)
        }

        fakeDb.set(acceptingId, acceptingSummary)
        fakeDb.set(requestingId, requestingSummary)
        return result
      },
    ),

    removeFriendRequest: jest.fn(async (fromId: SbUserId, toId: SbUserId) => {
      const fromSummary = fakeDb.get(fromId) ?? createSummary()
      const toSummary = fakeDb.get(toId) ?? createSummary()

      const hasRequest = fromSummary.outgoingRequests.find(r => r.toId === toId)
      if (hasRequest) {
        fromSummary.outgoingRequests = fromSummary.outgoingRequests.filter(r => r.toId !== toId)
        toSummary.incomingRequests = toSummary.incomingRequests.filter(r => r.fromId !== fromId)
      }

      fakeDb.set(fromId, fromSummary)
      fakeDb.set(toId, toSummary)
      return hasRequest
    }),

    removeFriend: jest.fn(async (removerId: SbUserId, targetId: SbUserId) => {
      const removerSummary = fakeDb.get(removerId) ?? createSummary()
      const targetSummary = fakeDb.get(targetId) ?? createSummary()

      const hasFriend = removerSummary.friends.find(r => r.toId === targetId)
      if (hasFriend) {
        removerSummary.friends = removerSummary.friends.filter(r => r.toId !== targetId)
        targetSummary.friends = targetSummary.friends.filter(r => r.toId !== removerId)
      }

      fakeDb.set(removerId, removerSummary)
      fakeDb.set(targetId, targetSummary)
      return hasFriend
    }),

    blockUser: jest.fn(async (blockerId: SbUserId, targetId: SbUserId, date: Date) => {
      const UserRelationshipType = await userRelationshipTypePromise

      const blockerSummary = fakeDb.get(blockerId) ?? createSummary()
      const targetSummary = fakeDb.get(targetId) ?? createSummary()

      const result: UserRelationship[] = []

      if (
        blockerSummary.blocks.find(r => r.toId === targetId) ||
        targetSummary.blocks.find(r => r.toId === blockerId)
      ) {
        // These users are already blocking each other (at least on one side)
        const blockerRelationship = blockerSummary.blocks.find(r => r.toId === targetId)
        const targetRelationship = targetSummary.blocks.find(r => r.toId === blockerId)

        if (blockerRelationship) {
          result.push(blockerRelationship)
        } else {
          const newRelationship = {
            fromId: blockerId,
            toId: targetId,
            kind: UserRelationshipType.Block,
            createdAt: new Date(date),
          }
          result.push(newRelationship)
          blockerSummary.blocks.push(newRelationship)
        }

        if (targetRelationship) {
          result.push(targetRelationship)
        }
      } else {
        const newRelationship = {
          fromId: blockerId,
          toId: targetId,
          kind: UserRelationshipType.Block,
          createdAt: new Date(date),
        }
        result.push(newRelationship)
        blockerSummary.blocks.push(newRelationship)
      }

      blockerSummary.friends = blockerSummary.friends.filter(r => r.toId !== targetId)
      blockerSummary.incomingRequests = blockerSummary.incomingRequests.filter(
        r => r.fromId !== targetId,
      )
      blockerSummary.outgoingRequests = blockerSummary.outgoingRequests.filter(
        r => r.toId !== targetId,
      )

      targetSummary.friends = targetSummary.friends.filter(r => r.toId !== blockerId)
      targetSummary.incomingRequests = targetSummary.incomingRequests.filter(
        r => r.fromId !== blockerId,
      )
      targetSummary.outgoingRequests = targetSummary.outgoingRequests.filter(
        r => r.toId !== blockerId,
      )

      fakeDb.set(blockerId, blockerSummary)
      fakeDb.set(targetId, targetSummary)
      return result
    }),

    unblockUser: jest.fn(async (unblockerId: SbUserId, targetId: SbUserId) => {
      const unblockerSummary = fakeDb.get(unblockerId) ?? createSummary()
      const targetSummary = fakeDb.get(targetId) ?? createSummary()

      const result: UserRelationship[] = []

      const unblockerRelationship = unblockerSummary.blocks.find(r => r.toId === targetId)
      if (unblockerRelationship) {
        unblockerSummary.blocks = unblockerSummary.blocks.filter(r => r.toId !== targetId)
      } else {
        const relationship =
          unblockerSummary.friends.find(r => r.toId === targetId) ??
          unblockerSummary.outgoingRequests.find(r => r.toId === targetId) ??
          unblockerSummary.incomingRequests.find(r => r.fromId === targetId)
        if (relationship) {
          result.push(relationship)
        }
      }

      const targetRelationship = targetSummary.blocks.find(r => r.toId === unblockerId)
      if (targetRelationship) {
        // Overrides any other relationships that may exist (note that in the actual DB those
        // relationships can't actually exist, since it's a single row)
        result.length = 0
        result.push(targetRelationship)
      } else {
        const relationship =
          targetSummary.friends.find(r => r.toId === unblockerId) ??
          targetSummary.outgoingRequests.find(r => r.toId === unblockerId) ??
          targetSummary.incomingRequests.find(r => r.fromId === unblockerId)
        if (relationship) {
          result.push(relationship)
        }
      }

      fakeDb.set(unblockerId, unblockerSummary)
      fakeDb.set(targetId, targetSummary)
      return result
    }),

    isUserBlockedBy: jest.fn(async (userId: SbUserId, potentialBlocker: SbUserId) => {
      const blockerSummary = fakeDb.get(potentialBlocker)
      return blockerSummary?.blocks?.some(r => r.toId === userId) ?? false
    }),
  }
})

describe('users/user-relationship-service', () => {
  let nydus: NydusServer
  let userRelationshipService: UserRelationshipService
  let connector: NydusConnector
  let notificationService: NotificationService
  let clock: FakeClock

  let client1: InspectableNydusClient
  let client2: InspectableNydusClient

  beforeEach(() => {
    nydus = createFakeNydusServer()
    const sessionLookup = new RequestSessionLookup()
    const userSocketsManager = new UserSocketsManager(nydus, sessionLookup, async () => {})
    const publisher = new TypedPublisher(nydus)

    notificationService = createFakeNotificationService()
    clock = new FakeClock()
    clock.setCurrentTime(Number(new Date('2022-08-31T00:00:00.000Z')))

    clearFakeDb()

    userRelationshipService = new UserRelationshipService(
      clock,
      publisher,
      userSocketsManager,
      notificationService,
    )
    connector = new NydusConnector(nydus, sessionLookup)

    client1 = connector.connectClient({ id: makeSbUserId(1), name: 'One' }, 'one')
    client2 = connector.connectClient({ id: makeSbUserId(2), name: 'Two' }, 'two')

    asMockedFunction(client1.publish).mockClear()
    asMockedFunction(client2.publish).mockClear()
    clearTestLogs(nydus)
  })

  describe('sending friend requests', () => {
    test('should throw if sending a request to self', async () => {
      await expect(
        userRelationshipService.sendFriendRequest(makeSbUserId(1), makeSbUserId(1)),
      ).rejects.toThrowErrorMatchingInlineSnapshot(`"Can't send a friend request to yourself"`)
    })

    test('should send a friend request to another user', async () => {
      const FROM = makeSbUserId(1)
      const TO = makeSbUserId(2)

      const result = await userRelationshipService.sendFriendRequest(FROM, TO)

      expect(result).toEqual({
        fromId: FROM,
        toId: TO,
        kind: UserRelationshipKind.FriendRequest,
        createdAt: new Date(clock.now()),
      })

      expect(notificationService.addNotification).toHaveBeenCalledWith({
        userId: TO,
        data: {
          type: NotificationType.FriendRequest,
          from: FROM,
        },
      })

      expect(client1.publish).toHaveBeenCalledWith(getRelationshipsPath(FROM), {
        type: 'upsert',
        relationship: {
          fromId: FROM,
          toId: TO,
          kind: UserRelationshipKind.FriendRequest,
          createdAt: clock.now(),
        },
      })
      expect(client2.publish).toHaveBeenCalledWith(getRelationshipsPath(TO), {
        type: 'upsert',
        relationship: {
          fromId: FROM,
          toId: TO,
          kind: UserRelationshipKind.FriendRequest,
          createdAt: clock.now(),
        },
      })
    })

    test('should fail to friend request a user that has blocked you', async () => {
      await userRelationshipService.blockUser(makeSbUserId(2), makeSbUserId(1))

      await expect(
        userRelationshipService.sendFriendRequest(makeSbUserId(1), makeSbUserId(2)),
      ).rejects.toThrowErrorMatchingInlineSnapshot(`"You have been blocked by this user"`)
      expect(notificationService.addNotification).not.toHaveBeenCalled()
    })

    test('should be idempotent', async () => {
      const FROM = makeSbUserId(1)
      const TO = makeSbUserId(2)

      const initialDate = new Date(clock.now())
      await userRelationshipService.sendFriendRequest(FROM, TO)
      clock.setCurrentTime(clock.now() + 1000)
      const result = await userRelationshipService.sendFriendRequest(FROM, TO)

      expect(result).toEqual({
        fromId: FROM,
        toId: TO,
        kind: UserRelationshipKind.FriendRequest,
        createdAt: initialDate,
      })
      expect(notificationService.addNotification).toHaveBeenCalledOnce()
      expect(notificationService.addNotification).toHaveBeenCalledWith({
        userId: TO,
        data: {
          type: NotificationType.FriendRequest,
          from: FROM,
        },
      })

      expect(client1.publish).toHaveBeenCalledWith(getRelationshipsPath(FROM), {
        type: 'upsert',
        relationship: {
          fromId: FROM,
          toId: TO,
          kind: UserRelationshipKind.FriendRequest,
          createdAt: Number(initialDate),
        },
      })
      expect(client2.publish).toHaveBeenCalledWith(getRelationshipsPath(TO), {
        type: 'upsert',
        relationship: {
          fromId: FROM,
          toId: TO,
          kind: UserRelationshipKind.FriendRequest,
          createdAt: Number(initialDate),
        },
      })
    })

    test("should complete a friendship if there's a request in the other direction", async () => {
      const FROM = makeSbUserId(1)
      const TO = makeSbUserId(2)

      await userRelationshipService.sendFriendRequest(TO, FROM)
      asMockedFunction(notificationService.addNotification).mockClear()
      const result = await userRelationshipService.sendFriendRequest(FROM, TO)

      expect(result).toEqual({
        fromId: FROM,
        toId: TO,
        kind: UserRelationshipKind.Friend,
        createdAt: new Date(clock.now()),
      })
      expect(notificationService.addNotification).toHaveBeenCalledWith({
        userId: TO,
        data: {
          type: NotificationType.FriendStart,
          with: FROM,
        },
      })
      expect(notificationService.addNotification).toHaveBeenCalledWith({
        userId: FROM,
        data: {
          type: NotificationType.FriendStart,
          with: TO,
        },
      })
      expect(notificationService.clearFirstMatching).toHaveBeenCalledWith({
        userId: FROM,
        data: {
          type: NotificationType.FriendRequest,
          from: TO,
        },
      })

      expect(client1.publish).toHaveBeenCalledWith(getRelationshipsPath(FROM), {
        type: 'upsert',
        relationship: {
          fromId: FROM,
          toId: TO,
          kind: UserRelationshipKind.Friend,
          createdAt: clock.now(),
        },
      })
      expect(client2.publish).toHaveBeenCalledWith(getRelationshipsPath(TO), {
        type: 'upsert',
        relationship: {
          fromId: TO,
          toId: FROM,
          kind: UserRelationshipKind.Friend,
          createdAt: clock.now(),
        },
      })
    })

    test('should prevent new requests when over the friend limit', async () => {
      const FROM = makeSbUserId(1)
      for (let i = 2; i < MAX_FRIENDS + 2; i++) {
        await userRelationshipService.sendFriendRequest(FROM, makeSbUserId(i))
      }

      await expect(
        userRelationshipService.sendFriendRequest(makeSbUserId(1), makeSbUserId(9001)),
      ).rejects.toThrowErrorMatchingInlineSnapshot(
        `"Too many friends or outgoing requests, please remove some to add more"`,
      )
    })
  })

  describe('accepting friend requests', () => {
    test('should throw if accepting a request to self', async () => {
      await expect(
        userRelationshipService.acceptFriendRequest(makeSbUserId(1), makeSbUserId(1)),
      ).rejects.toThrowErrorMatchingInlineSnapshot(`"Can't accept a friend request from yourself"`)
    })

    test("should succeed if there's a matching request", async () => {
      const FROM = makeSbUserId(1)
      const TO = makeSbUserId(2)

      await userRelationshipService.sendFriendRequest(TO, FROM)
      asMockedFunction(notificationService.addNotification).mockClear()
      const result = await userRelationshipService.acceptFriendRequest(FROM, TO)

      expect(result).toEqual({
        fromId: FROM,
        toId: TO,
        kind: UserRelationshipKind.Friend,
        createdAt: new Date(clock.now()),
      })
      expect(notificationService.addNotification).toHaveBeenCalledWith({
        userId: TO,
        data: {
          type: NotificationType.FriendStart,
          with: FROM,
        },
      })
      expect(notificationService.addNotification).toHaveBeenCalledWith({
        userId: FROM,
        data: {
          type: NotificationType.FriendStart,
          with: TO,
        },
      })
      expect(notificationService.clearFirstMatching).toHaveBeenCalledWith({
        userId: FROM,
        data: {
          type: NotificationType.FriendRequest,
          from: TO,
        },
      })

      expect(client1.publish).toHaveBeenCalledWith(getRelationshipsPath(FROM), {
        type: 'upsert',
        relationship: {
          fromId: FROM,
          toId: TO,
          kind: UserRelationshipKind.Friend,
          createdAt: clock.now(),
        },
      })
      expect(client2.publish).toHaveBeenCalledWith(getRelationshipsPath(TO), {
        type: 'upsert',
        relationship: {
          fromId: TO,
          toId: FROM,
          kind: UserRelationshipKind.Friend,
          createdAt: clock.now(),
        },
      })
    })

    test('should fail if there is no matching request', async () => {
      await expect(
        userRelationshipService.acceptFriendRequest(makeSbUserId(1), makeSbUserId(2)),
      ).rejects.toThrowErrorMatchingInlineSnapshot(
        `"Could not find a friend request from this user"`,
      )
    })

    test('should be idempotent', async () => {
      const FROM = makeSbUserId(1)
      const TO = makeSbUserId(2)

      const initialDate = new Date(clock.now())
      await userRelationshipService.sendFriendRequest(TO, FROM)
      asMockedFunction(notificationService.addNotification).mockClear()
      await userRelationshipService.acceptFriendRequest(FROM, TO)
      clock.setCurrentTime(clock.now() + 1000)
      const result = await userRelationshipService.acceptFriendRequest(FROM, TO)

      expect(result).toEqual({
        fromId: FROM,
        toId: TO,
        kind: UserRelationshipKind.Friend,
        createdAt: initialDate,
      })
      expect(notificationService.addNotification).toHaveBeenCalledTimes(2)
      expect(notificationService.addNotification).toHaveBeenCalledWith({
        userId: TO,
        data: {
          type: NotificationType.FriendStart,
          with: FROM,
        },
      })
      expect(notificationService.addNotification).toHaveBeenCalledWith({
        userId: FROM,
        data: {
          type: NotificationType.FriendStart,
          with: TO,
        },
      })

      expect(client1.publish).toHaveBeenCalledWith(getRelationshipsPath(FROM), {
        type: 'upsert',
        relationship: {
          fromId: FROM,
          toId: TO,
          kind: UserRelationshipKind.Friend,
          createdAt: Number(initialDate),
        },
      })
      expect(client2.publish).toHaveBeenCalledWith(getRelationshipsPath(TO), {
        type: 'upsert',
        relationship: {
          fromId: TO,
          toId: FROM,
          kind: UserRelationshipKind.Friend,
          createdAt: Number(initialDate),
        },
      })
    })

    test('should prevent accepting when over the friend limit', async () => {
      const FROM = makeSbUserId(1)
      for (let i = 2; i < MAX_FRIENDS + 2; i++) {
        await userRelationshipService.sendFriendRequest(makeSbUserId(i), FROM)
        await userRelationshipService.acceptFriendRequest(FROM, makeSbUserId(i))
      }
      await userRelationshipService.sendFriendRequest(makeSbUserId(9001), FROM)

      await expect(
        userRelationshipService.acceptFriendRequest(FROM, makeSbUserId(9001)),
      ).rejects.toThrowErrorMatchingInlineSnapshot(
        `"Too many friends or outgoing requests, please remove some to add more"`,
      )
    })
  })

  describe('removing friend requests', () => {
    test('should throw if removing a request from self', async () => {
      await expect(
        userRelationshipService.removeFriendRequest(makeSbUserId(1), makeSbUserId(1)),
      ).rejects.toThrowErrorMatchingInlineSnapshot(`"Can't remove a friend request from yourself"`)
    })

    test('should remove an outgoing friend request', async () => {
      const FROM = makeSbUserId(1)
      const TO = makeSbUserId(2)

      await userRelationshipService.sendFriendRequest(FROM, TO)
      const notificationId = 'NOTIFICATION_ID'
      asMockedFunction(notificationService.retrieveNotifications).mockResolvedValueOnce([
        {
          userId: TO,
          id: notificationId,
          data: { type: NotificationType.FriendRequest, from: FROM },
          read: false,
          visible: true,
          createdAt: new Date(clock.now()),
        },
      ])
      asMockedFunction(client1.publish).mockClear()
      asMockedFunction(client2.publish).mockClear()

      await userRelationshipService.removeFriendRequest(FROM, TO)

      expect(notificationService.clearById).toHaveBeenCalledWith(TO, notificationId)
      expect(client1.publish).toHaveBeenCalledWith(getRelationshipsPath(FROM), {
        type: 'delete',
        targetUser: TO,
      })
      expect(client2.publish).toHaveBeenCalledWith(getRelationshipsPath(TO), {
        type: 'delete',
        targetUser: FROM,
      })
    })

    test('should throw if no friend request is found', async () => {
      await expect(
        userRelationshipService.removeFriendRequest(makeSbUserId(1), makeSbUserId(2)),
      ).rejects.toThrowErrorMatchingInlineSnapshot(
        `"Could not find a friend request from this user"`,
      )
    })
  })

  describe('removing friends', () => {
    test('should throw if removing self', async () => {
      await expect(
        userRelationshipService.removeFriend(makeSbUserId(1), makeSbUserId(1)),
      ).rejects.toThrowErrorMatchingInlineSnapshot(`"Can't remove friendship with yourself"`)
    })

    test('should remove a friend', async () => {
      const FROM = makeSbUserId(1)
      const TO = makeSbUserId(2)

      await userRelationshipService.sendFriendRequest(FROM, TO)
      await userRelationshipService.acceptFriendRequest(TO, FROM)
      asMockedFunction(client1.publish).mockClear()
      asMockedFunction(client2.publish).mockClear()

      await userRelationshipService.removeFriend(FROM, TO)

      expect(client1.publish).toHaveBeenCalledWith(getRelationshipsPath(FROM), {
        type: 'delete',
        targetUser: TO,
      })
      expect(client2.publish).toHaveBeenCalledWith(getRelationshipsPath(TO), {
        type: 'delete',
        targetUser: FROM,
      })
    })

    test('should throw if no friend is found', async () => {
      await expect(
        userRelationshipService.removeFriend(makeSbUserId(1), makeSbUserId(2)),
      ).rejects.toThrowErrorMatchingInlineSnapshot(`"Not currently friends with that user"`)
    })
  })

  describe('blocks', () => {
    test('should throw if blocking self', async () => {
      await expect(
        userRelationshipService.blockUser(makeSbUserId(1), makeSbUserId(1)),
      ).rejects.toThrowErrorMatchingInlineSnapshot(`"Can't block yourself"`)
    })

    test('should allow blocking another user', async () => {
      const FROM = makeSbUserId(1)
      const TO = makeSbUserId(2)

      const result = await userRelationshipService.blockUser(FROM, TO)

      expect(result).toEqual({
        fromId: FROM,
        toId: TO,
        kind: UserRelationshipKind.Block,
        createdAt: new Date(clock.now()),
      })

      expect(client1.publish).toHaveBeenCalledWith(getRelationshipsPath(FROM), {
        type: 'upsert',
        relationship: {
          fromId: FROM,
          toId: TO,
          kind: UserRelationshipKind.Block,
          createdAt: clock.now(),
        },
      })
      expect(client2.publish).toHaveBeenCalledWith(getRelationshipsPath(TO), {
        type: 'delete',
        targetUser: FROM,
      })
    })

    test('should allow making a mutual block', async () => {
      const FROM = makeSbUserId(1)
      const TO = makeSbUserId(2)

      await userRelationshipService.blockUser(TO, FROM)
      asMockedFunction(client2.publish).mockClear()
      clock.setCurrentTime(clock.now() + 1000)

      const result = await userRelationshipService.blockUser(FROM, TO)

      expect(result).toEqual({
        fromId: FROM,
        toId: TO,
        kind: UserRelationshipKind.Block,
        createdAt: new Date(clock.now()),
      })

      expect(client1.publish).toHaveBeenCalledWith(getRelationshipsPath(FROM), {
        type: 'upsert',
        relationship: {
          fromId: FROM,
          toId: TO,
          kind: UserRelationshipKind.Block,
          createdAt: clock.now(),
        },
      })
      expect(client2.publish).toHaveBeenCalledTimes(0)
    })

    test('should override an outgoing friend request', async () => {
      const FROM = makeSbUserId(1)
      const TO = makeSbUserId(2)

      await userRelationshipService.sendFriendRequest(FROM, TO)
      asMockedFunction(client1.publish).mockClear()
      asMockedFunction(client2.publish).mockClear()
      const result = await userRelationshipService.blockUser(FROM, TO)

      expect(result).toEqual({
        fromId: FROM,
        toId: TO,
        kind: UserRelationshipKind.Block,
        createdAt: new Date(clock.now()),
      })

      expect(client1.publish).toHaveBeenCalledWith(getRelationshipsPath(FROM), {
        type: 'upsert',
        relationship: {
          fromId: FROM,
          toId: TO,
          kind: UserRelationshipKind.Block,
          createdAt: clock.now(),
        },
      })
      expect(client2.publish).toHaveBeenCalledWith(getRelationshipsPath(TO), {
        type: 'delete',
        targetUser: FROM,
      })
    })

    test('should override a friendship', async () => {
      const FROM = makeSbUserId(1)
      const TO = makeSbUserId(2)

      await userRelationshipService.sendFriendRequest(FROM, TO)
      await userRelationshipService.acceptFriendRequest(TO, FROM)
      asMockedFunction(client1.publish).mockClear()
      asMockedFunction(client2.publish).mockClear()
      const result = await userRelationshipService.blockUser(FROM, TO)

      expect(result).toEqual({
        fromId: FROM,
        toId: TO,
        kind: UserRelationshipKind.Block,
        createdAt: new Date(clock.now()),
      })

      expect(client1.publish).toHaveBeenCalledWith(getRelationshipsPath(FROM), {
        type: 'upsert',
        relationship: {
          fromId: FROM,
          toId: TO,
          kind: UserRelationshipKind.Block,
          createdAt: clock.now(),
        },
      })
      expect(client2.publish).toHaveBeenCalledWith(getRelationshipsPath(TO), {
        type: 'delete',
        targetUser: FROM,
      })
    })

    test('should be idempotent', async () => {
      const FROM = makeSbUserId(1)
      const TO = makeSbUserId(2)

      const initDate = new Date(clock.now())
      await userRelationshipService.blockUser(FROM, TO)
      clock.setCurrentTime(clock.now() + 1000)
      const result = await userRelationshipService.blockUser(FROM, TO)

      expect(result).toEqual({
        fromId: FROM,
        toId: TO,
        kind: UserRelationshipKind.Block,
        createdAt: initDate,
      })

      expect(client1.publish).toHaveBeenCalledOnce()
      expect(client1.publish).toHaveBeenCalledWith(getRelationshipsPath(FROM), {
        type: 'upsert',
        relationship: {
          fromId: FROM,
          toId: TO,
          kind: UserRelationshipKind.Block,
          createdAt: Number(initDate),
        },
      })
      expect(client2.publish).toHaveBeenCalledOnce()
      expect(client2.publish).toHaveBeenCalledWith(getRelationshipsPath(TO), {
        type: 'delete',
        targetUser: FROM,
      })
    })

    test('should prevent blocking when over the block limit', async () => {
      const FROM = makeSbUserId(1)
      for (let i = 2; i < MAX_BLOCKS + 2; i++) {
        await userRelationshipService.blockUser(FROM, makeSbUserId(i))
      }

      await expect(
        userRelationshipService.blockUser(FROM, makeSbUserId(9001)),
      ).rejects.toThrowErrorMatchingInlineSnapshot(
        `"Too many users blocked, please remove some to add more"`,
      )
    })
  })

  describe('unblocking', () => {
    test('should throw if unblocking self', async () => {
      await expect(
        userRelationshipService.unblockUser(makeSbUserId(1), makeSbUserId(1)),
      ).rejects.toThrowErrorMatchingInlineSnapshot(`"Can't unblock yourself"`)
    })

    test('should work for a 1-way block', async () => {
      const FROM = makeSbUserId(1)
      const TO = makeSbUserId(2)

      await userRelationshipService.blockUser(FROM, TO)
      asMockedFunction(client1.publish).mockClear()
      asMockedFunction(client2.publish).mockClear()

      await userRelationshipService.unblockUser(FROM, TO)

      expect(client1.publish).toHaveBeenCalledWith(getRelationshipsPath(FROM), {
        type: 'delete',
        targetUser: TO,
      })
    })

    test('should work for a mutual block', async () => {
      const FROM = makeSbUserId(1)
      const TO = makeSbUserId(2)

      await userRelationshipService.blockUser(FROM, TO)
      await userRelationshipService.blockUser(TO, FROM)
      asMockedFunction(client1.publish).mockClear()
      asMockedFunction(client2.publish).mockClear()

      await userRelationshipService.unblockUser(FROM, TO)

      expect(client1.publish).toHaveBeenCalledWith(getRelationshipsPath(FROM), {
        type: 'delete',
        targetUser: TO,
      })
    })

    // NOTE(tec27): block removals otherwise are idempotent (they don't throw)
    test('should throw if no block found (different kind of reverse relationship)', async () => {
      const FROM = makeSbUserId(1)
      const TO = makeSbUserId(2)

      await userRelationshipService.sendFriendRequest(TO, FROM)

      await expect(
        userRelationshipService.unblockUser(FROM, TO),
      ).rejects.toThrowErrorMatchingInlineSnapshot(`"Not currently blocking that user"`)
    })

    test('should throw if no block found (different kind of outgoing relationship)', async () => {
      const FROM = makeSbUserId(1)
      const TO = makeSbUserId(2)

      await userRelationshipService.sendFriendRequest(FROM, TO)

      await expect(
        userRelationshipService.unblockUser(FROM, TO),
      ).rejects.toThrowErrorMatchingInlineSnapshot(`"Not currently blocking that user"`)
    })
  })

  describe('activity status updates', () => {
    test('should give status updates on connect for existing friendships', async () => {
      const USER = makeSbUserId(1)

      await userRelationshipService.sendFriendRequest(makeSbUserId(2), USER)
      await userRelationshipService.sendFriendRequest(makeSbUserId(3), USER)
      await userRelationshipService.acceptFriendRequest(USER, makeSbUserId(2))
      await userRelationshipService.acceptFriendRequest(USER, makeSbUserId(3))

      const nextClient = connector.connectClient({ id: makeSbUserId(1), name: 'One' }, 'another')
      await Promise.resolve()

      expect(nextClient.publish).toHaveBeenCalledWith(
        getFriendActivityStatusPath(makeSbUserId(2)),
        {
          userId: makeSbUserId(2),
          status: FriendActivityStatus.Online,
        },
      )
      // not online, so no publish
      expect(nextClient.publish).not.toHaveBeenCalledWith(
        getFriendActivityStatusPath(makeSbUserId(3)),
        {
          userId: makeSbUserId(3),
          status: FriendActivityStatus.Online,
        },
      )

      asMockedFunction(nextClient.publish).mockClear()
      client2.disconnect()
      await Promise.resolve()
      expect(nextClient.publish).toHaveBeenCalledWith(
        getFriendActivityStatusPath(makeSbUserId(2)),
        {
          userId: makeSbUserId(2),
          status: FriendActivityStatus.Offline,
        },
      )
    })

    test('should give status updates for new friendships', async () => {
      const USER = makeSbUserId(1)
      const OTHER = makeSbUserId(2)

      await userRelationshipService.sendFriendRequest(OTHER, USER)
      await userRelationshipService.acceptFriendRequest(USER, OTHER)

      await Promise.resolve()

      expect(client1.publish).toHaveBeenCalledWith(getFriendActivityStatusPath(OTHER), {
        userId: OTHER,
        status: FriendActivityStatus.Online,
      })
      expect(client2.publish).toHaveBeenCalledWith(getFriendActivityStatusPath(USER), {
        userId: USER,
        status: FriendActivityStatus.Online,
      })
    })

    test('should unsubscribe when friendships end - remove friend', async () => {
      const USER = makeSbUserId(1)
      const OTHER = makeSbUserId(3)

      await userRelationshipService.sendFriendRequest(OTHER, USER)
      await userRelationshipService.acceptFriendRequest(USER, OTHER)
      await Promise.resolve()

      await userRelationshipService.removeFriend(USER, OTHER)
      await Promise.resolve()

      asMockedFunction(client1.publish).mockClear()

      client2.disconnect()
      await Promise.resolve()

      expect(client1.publish).not.toHaveBeenCalledWith(getFriendActivityStatusPath(OTHER), {
        userId: OTHER,
        status: FriendActivityStatus.Offline,
      })
    })

    test('should unsubscribe when friendships end - block', async () => {
      const USER = makeSbUserId(1)
      const OTHER = makeSbUserId(3)

      await userRelationshipService.sendFriendRequest(OTHER, USER)
      await userRelationshipService.acceptFriendRequest(USER, OTHER)
      await Promise.resolve()

      await userRelationshipService.blockUser(OTHER, USER)
      await Promise.resolve()

      asMockedFunction(client1.publish).mockClear()

      client2.disconnect()
      await Promise.resolve()

      expect(client1.publish).not.toHaveBeenCalledWith(getFriendActivityStatusPath(OTHER), {
        userId: OTHER,
        status: FriendActivityStatus.Offline,
      })
    })
  })
})
