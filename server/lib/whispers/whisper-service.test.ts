import { NydusServer } from 'nydus'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { asMockedFunction } from '../../../common/testing/mocks'
import { SbUser } from '../../../common/users/sb-user'
import { SbUserId } from '../../../common/users/sb-user-id'
import { WhisperMessageType, WhisperServiceErrorCode } from '../../../common/whispers'
import { RestrictionService } from '../users/restriction-service'
import { UserRelationshipService } from '../users/user-relationship-service'
import { RequestSessionLookup } from '../websockets/session-lookup'
import { UserSocketsManager } from '../websockets/socket-groups'
import {
  clearTestLogs,
  createFakeNydusServer,
  NydusConnector,
} from '../websockets/testing/websockets'
import { TypedPublisher } from '../websockets/typed-publisher'
import {
  addMessageToWhisper,
  getMessagesForWhisperSession,
  getUnreadWhisperTargets,
  getWhisperSessionsForUser,
  startWhisperSession,
  startWhisperSessionsBothDirections,
  updateLastReadTime,
} from './whisper-models'
import WhisperService, {
  getSessionPath,
  getWhisperUserPath,
  WhisperServiceError,
} from './whisper-service'

const { user1, user2, user3 } = vi.hoisted(() => ({
  user1: { id: 1 as SbUserId, name: 'USER_NAME_1', created: 1577836800000 } as SbUser,
  user2: { id: 2 as SbUserId, name: 'USER_NAME_2', created: 1577836800000 } as SbUser,
  user3: { id: 3 as SbUserId, name: 'USER_NAME_3', created: 1577836800000 } as SbUser,
}))

vi.mock('../users/user-model', () => {
  const USERS_BY_ID: ReadonlyMap<SbUserId, SbUser> = new Map(
    [user1, user2, user3].map(u => [u.id, u]),
  )

  return {
    findUserById: vi.fn().mockImplementation(async (id: SbUserId) => USERS_BY_ID.get(id)),
    findUsersById: vi.fn().mockImplementation(async (ids: ReadonlyArray<SbUserId>) => {
      return ids.map(id => USERS_BY_ID.get(id)).filter(u => !!u)
    }),
    findUsersByName: vi.fn().mockResolvedValue([]),
  }
})

vi.mock('../chat/chat-models', async () => {
  const originalModule =
    await vi.importActual<typeof import('../chat/chat-models')>('../chat/chat-models')
  return {
    getChannelInfos: vi.fn().mockResolvedValue([]),
    findChannelsByName: vi.fn().mockResolvedValue([]),
    toBasicChannelInfo: originalModule.toBasicChannelInfo,
  }
})

vi.mock('./whisper-models', () => ({
  getWhisperSessionsForUser: vi.fn().mockResolvedValue([]),
  getUnreadWhisperTargets: vi.fn().mockResolvedValue([]),
  updateLastReadTime: vi.fn(),
  startWhisperSession: vi.fn(),
  startWhisperSessionsBothDirections: vi.fn(),
  closeWhisperSession: vi.fn(),
  addMessageToWhisper: vi.fn(),
  getMessagesForWhisperSession: vi
    .fn()
    .mockResolvedValue({ messages: [], hasMoreBefore: false, hasMoreAfter: false }),
}))

const mockRestrictionService = {
  isRestricted: vi.fn().mockResolvedValue(false),
} as any as RestrictionService

const mockUserRelationshipService = {
  getBlocksBetween: vi.fn().mockResolvedValue({ aBlocksB: false, bBlocksA: false }),
} as any as UserRelationshipService

describe('whispers/whisper-service', () => {
  let nydus: NydusServer
  let whisperService: WhisperService
  let connector: NydusConnector

  beforeEach(async () => {
    // Restored explicitly rather than left to `clearAllMocks` (which keeps implementations), since
    // connecting a client below loads sessions through these and a previous test's return value
    // would seed this test's in-memory session state.
    asMockedFunction(getWhisperSessionsForUser).mockResolvedValue([])
    asMockedFunction(getUnreadWhisperTargets).mockResolvedValue([])

    nydus = createFakeNydusServer()
    const sessionLookup = new RequestSessionLookup()
    const userSocketsManager = new UserSocketsManager(nydus, sessionLookup, async () => {})
    const publisher = new TypedPublisher(nydus)

    whisperService = new WhisperService(
      publisher,
      userSocketsManager,
      mockRestrictionService,
      mockUserRelationshipService,
    )
    connector = new NydusConnector(nydus, sessionLookup)

    connector.connectClient(user1, 'USER1_CLIENT_ID')
    // Connecting kicks off an async session load; let it finish before tests install their own
    // mock behavior, so it can't overwrite in-memory session state mid-test.
    await new Promise(resolve => setTimeout(resolve, 20))

    vi.clearAllMocks()
    clearTestLogs(nydus)
  })

  describe('markRead', () => {
    const updateLastReadTimeMock = asMockedFunction(updateLastReadTime)
    const reportedTime = new Date('2023-03-12T00:00:00.000Z')

    test("publishes the position the DB stored, on the reporting user's own path", async () => {
      // The DB clamps the reported position, so what gets published has to come back from it
      // rather than being echoed from the request.
      const storedTime = new Date('2023-03-13T00:00:00.000Z')
      updateLastReadTimeMock.mockResolvedValue(storedTime)

      await whisperService.markRead(user1.id, user2.id, reportedTime)

      expect(updateLastReadTimeMock).toHaveBeenCalledWith(user1.id, user2.id, reportedTime)
      expect(nydus.publish).toHaveBeenCalledWith(getWhisperUserPath(user1.id), {
        action: 'lastReadTimeChanged',
        target: user2.id,
        lastReadTime: storedTime.getTime(),
      })
      // The conversation path is subscribed to by both participants, so a read position must never
      // reach it.
      expect(nydus.publish).not.toHaveBeenCalledWith(
        getSessionPath(user1.id, user2.id),
        expect.anything(),
      )
    })

    test('publishes nothing when there was no session row to update', async () => {
      updateLastReadTimeMock.mockResolvedValue(undefined)

      await whisperService.markRead(user1.id, user2.id, reportedTime)

      expect(nydus.publish).not.toHaveBeenCalled()
    })
  })

  describe('getWhisperSessions', () => {
    test('returns unread targets and a read position for every session', async () => {
      const user2ReadTime = new Date('2023-03-12T00:00:00.000Z')
      const user3StartDate = new Date('2023-03-10T00:00:00.000Z')
      asMockedFunction(getWhisperSessionsForUser).mockResolvedValue([
        {
          targetId: user2.id,
          lastReadTime: user2ReadTime,
          startDate: new Date('2023-03-01T00:00:00.000Z'),
        },
        { targetId: user3.id, lastReadTime: undefined, startDate: user3StartDate },
      ])
      asMockedFunction(getUnreadWhisperTargets).mockResolvedValue([user3.id])

      const result = await whisperService.getWhisperSessions(user1.id)

      expect(result).toEqual({
        sessions: [user2.id, user3.id],
        users: [user2, user3],
        unreadSessions: [user3.id],
        lastReadTimes: [
          { targetId: user2.id, lastReadTime: user2ReadTime.getTime() },
          // A session with no recorded position is unread from its start date on, so its marker
          // sits one millisecond before that.
          { targetId: user3.id, lastReadTime: user3StartDate.getTime() - 1 },
        ],
      })
    })
  })

  describe('sendWhisperMessage', () => {
    const getBlocksBetweenMock = asMockedFunction(mockUserRelationshipService.getBlocksBetween)
    const addMessageToWhisperMock = asMockedFunction(addMessageToWhisper)

    beforeEach(() => {
      getBlocksBetweenMock.mockResolvedValue({ aBlocksB: false, bBlocksA: false })
    })

    test('throws and stores nothing when the target has blocked the sender', async () => {
      getBlocksBetweenMock.mockResolvedValue({ aBlocksB: false, bBlocksA: true })

      const sendPromise = whisperService.sendWhisperMessage(user1.id, user2.id, 'hi')
      await expect(sendPromise).rejects.toBeInstanceOf(WhisperServiceError)
      await expect(sendPromise).rejects.toMatchObject({
        code: WhisperServiceErrorCode.BlockedByUser,
      })

      expect(startWhisperSessionsBothDirections).not.toHaveBeenCalled()
      expect(addMessageToWhisperMock).not.toHaveBeenCalled()
    })

    test('throws and stores nothing when the sender has blocked the target', async () => {
      getBlocksBetweenMock.mockResolvedValue({ aBlocksB: true, bBlocksA: false })

      const sendPromise = whisperService.sendWhisperMessage(user1.id, user2.id, 'hi')
      await expect(sendPromise).rejects.toBeInstanceOf(WhisperServiceError)
      await expect(sendPromise).rejects.toMatchObject({
        code: WhisperServiceErrorCode.UserBlocked,
      })

      expect(startWhisperSessionsBothDirections).not.toHaveBeenCalled()
      expect(addMessageToWhisperMock).not.toHaveBeenCalled()
    })

    test('stores and publishes the message when neither user has blocked the other', async () => {
      const sent = new Date('2023-03-12T00:00:00.000Z')
      addMessageToWhisperMock.mockResolvedValue({
        id: 'MESSAGE_ID',
        from: user1.id,
        to: user2.id,
        sent,
        data: { type: WhisperMessageType.TextMessage, text: 'hi' },
      })

      await whisperService.sendWhisperMessage(user1.id, user2.id, 'hi')

      expect(addMessageToWhisperMock).toHaveBeenCalledWith(user1.id, user2.id, {
        type: WhisperMessageType.TextMessage,
        text: 'hi',
        mentions: undefined,
        channelMentions: undefined,
      })
      expect(nydus.publish).toHaveBeenCalledWith(getSessionPath(user1.id, user2.id), {
        action: 'message',
        message: {
          id: 'MESSAGE_ID',
          type: WhisperMessageType.TextMessage,
          from: user1.id,
          to: user2.id,
          time: sent.getTime(),
          text: 'hi',
        },
        users: [user1, user2],
        mentions: [],
        channelMentions: [],
      })
    })
  })

  describe('getSessionHistory', () => {
    beforeEach(async () => {
      asMockedFunction(startWhisperSession).mockResolvedValue(undefined)
      await whisperService.startWhisperSession(user1.id, user2.id)
    })

    test('throws when the user has no session with the target', async () => {
      await expect(
        whisperService.getSessionHistory(user1.id, user3.id),
      ).rejects.toThrowErrorMatchingInlineSnapshot(
        `[Error: Must have a whisper session with this user to retrieve message history]`,
      )
    })

    test('uses a newest cursor when no time param is given', async () => {
      asMockedFunction(getMessagesForWhisperSession).mockResolvedValue({
        messages: [],
        hasMoreBefore: true,
        hasMoreAfter: true,
      })

      const result = await whisperService.getSessionHistory(user1.id, user2.id, 50)

      expect(getMessagesForWhisperSession).toHaveBeenCalledWith(user1.id, user2.id, 50, {
        kind: 'newest',
      })
      expect(result.hasMoreBefore).toBe(true)
      expect(result.hasMoreAfter).toBe(true)
    })

    test('uses a before cursor when beforeTime is greater than -1', async () => {
      await whisperService.getSessionHistory(user1.id, user2.id, 50, 1000)

      expect(getMessagesForWhisperSession).toHaveBeenCalledWith(user1.id, user2.id, 50, {
        kind: 'before',
        date: new Date(1000),
      })
    })

    test('uses a newest cursor when beforeTime is -1', async () => {
      await whisperService.getSessionHistory(user1.id, user2.id, 50, -1)

      expect(getMessagesForWhisperSession).toHaveBeenCalledWith(user1.id, user2.id, 50, {
        kind: 'newest',
      })
    })

    test('uses an after cursor when afterTime is given', async () => {
      await whisperService.getSessionHistory(user1.id, user2.id, 50, undefined, 2000)

      expect(getMessagesForWhisperSession).toHaveBeenCalledWith(user1.id, user2.id, 50, {
        kind: 'after',
        date: new Date(2000),
      })
    })

    test('uses an around cursor when aroundTime is given', async () => {
      await whisperService.getSessionHistory(user1.id, user2.id, 50, undefined, undefined, 3000)

      expect(getMessagesForWhisperSession).toHaveBeenCalledWith(user1.id, user2.id, 50, {
        kind: 'around',
        date: new Date(3000),
      })
    })
  })
})
