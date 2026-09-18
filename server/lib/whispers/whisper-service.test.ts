import { NydusServer } from 'nydus'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { RolledOutcome } from '../../../common/rolled-outcomes'
import { asMockedFunction } from '../../../common/testing/mocks'
import { SbUser } from '../../../common/users/sb-user'
import { SbUserId } from '../../../common/users/sb-user-id'
import { WhisperMessageType, WhisperServiceErrorCode } from '../../../common/whispers'
import { rollOutcome } from '../messaging/roll-outcome'
import { RestrictionService } from '../users/restriction-service'
import { findUserById } from '../users/user-model'
import { RequestSessionLookup } from '../websockets/session-lookup'
import { UserSocketsManager } from '../websockets/socket-groups'
import {
  clearTestLogs,
  createFakeNydusServer,
  FakeNydusServer,
  NydusConnector,
} from '../websockets/testing/websockets'
import { TypedPublisher } from '../websockets/typed-publisher'
import {
  addMessageToWhisper,
  getMessagesForWhisperSession,
  getUnreadWhisperTargets,
  getWhisperMessageParticipants,
  getWhisperMessageSentTime,
  getWhisperSessionsForUser,
  startWhisperSession,
  startWhisperSessionsBothDirections,
  updateLastReadTime,
} from './whisper-models'
import WhisperService, { getSessionPath, getWhisperUserPath } from './whisper-service'

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

vi.mock('../messaging/roll-outcome', () => ({ rollOutcome: vi.fn() }))

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
  getWhisperMessageSentTime: vi.fn(),
  getWhisperMessageParticipants: vi.fn(),
}))

const mockRestrictionService = {
  isRestricted: vi.fn().mockResolvedValue(false),
} as any as RestrictionService

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

    whisperService = new WhisperService(publisher, userSocketsManager, mockRestrictionService)
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
    const addMessageToWhisperMock = asMockedFunction(addMessageToWhisper)

    /** Makes the stored-message lookup answer with a message of the given text and flag. */
    function mockStoredMessage(text: string, emote?: boolean) {
      addMessageToWhisperMock.mockResolvedValue({
        id: 'MESSAGE_ID',
        from: user1.id,
        to: user2.id,
        sent: new Date('2023-03-11T00:00:00.000Z'),
        data: {
          type: WhisperMessageType.TextMessage,
          text,
          mentions: undefined,
          channelMentions: undefined,
          ...(emote ? { emote: true } : {}),
        },
      })
    }

    /** The data of the message event published to the conversation, if there was one. */
    function publishedMessageEvent(): any {
      const fakeNydus = nydus as unknown as FakeNydusServer
      return fakeNydus.publish.mock.calls.find(
        ([path, data]) => path === getSessionPath(user1.id, user2.id) && data?.action === 'message',
      )?.[1]
    }

    test('stores and publishes an action line with the emote flag', async () => {
      mockStoredMessage('waves', true)

      await whisperService.sendWhisperMessage(user1.id, user2.id, 'waves', { emote: true })

      expect(addMessageToWhisperMock).toHaveBeenCalledWith(user1.id, user2.id, {
        type: WhisperMessageType.TextMessage,
        text: 'waves',
        mentions: undefined,
        channelMentions: undefined,
        emote: true,
      })
      expect(publishedMessageEvent().message).toMatchObject({ text: 'waves', emote: true })
    })

    test('carries no emote key at all for an ordinary message', async () => {
      mockStoredMessage('hello')

      await whisperService.sendWhisperMessage(user1.id, user2.id, 'hello')

      expect(addMessageToWhisperMock.mock.calls[0][2]).not.toHaveProperty('emote')
      expect(publishedMessageEvent().message).not.toHaveProperty('emote')
    })

    test("advances the sender's read position to the stored message and publishes it on the sender's own path", async () => {
      // Distinct from the message's `sent` time, to prove the published value comes back from the
      // DB result rather than being echoed from the stored message.
      const storedTime = new Date('2023-03-13T00:00:00.000Z')
      asMockedFunction(updateLastReadTime).mockResolvedValue(storedTime)
      mockStoredMessage('hello')

      await whisperService.sendWhisperMessage(user1.id, user2.id, 'hello')

      expect(updateLastReadTime).toHaveBeenCalledWith(
        user1.id,
        user2.id,
        new Date('2023-03-11T00:00:00.000Z'),
      )
      expect(nydus.publish).toHaveBeenCalledWith(getWhisperUserPath(user1.id), {
        action: 'lastReadTimeChanged',
        target: user2.id,
        lastReadTime: storedTime.getTime(),
      })
      // The recipient's own read position must not move, and a read position must never reach the
      // shared conversation path (it's subscribed to by both participants).
      expect(nydus.publish).not.toHaveBeenCalledWith(
        getWhisperUserPath(user2.id),
        expect.anything(),
      )
      expect(nydus.publish).not.toHaveBeenCalledWith(
        getSessionPath(user1.id, user2.id),
        expect.objectContaining({ action: 'lastReadTimeChanged' }),
      )
    })
  })

  describe('sendOutcome', () => {
    const ROLL: RolledOutcome = { kind: 'roll', max: 6, value: 4 }
    const addMessageToWhisperMock = asMockedFunction(addMessageToWhisper)
    const rollOutcomeMock = asMockedFunction(rollOutcome)

    /** Makes the stored-message lookup answer with an action line carrying `outcome`. */
    function mockStoredOutcome(text: string, outcome: RolledOutcome) {
      addMessageToWhisperMock.mockResolvedValue({
        id: 'MESSAGE_ID',
        from: user1.id,
        to: user2.id,
        sent: new Date('2023-03-11T00:00:00.000Z'),
        data: {
          type: WhisperMessageType.TextMessage,
          text,
          mentions: undefined,
          channelMentions: undefined,
          emote: true,
          outcome,
        },
      })
    }

    /** The data of the message event published to the conversation, if there was one. */
    function publishedMessageEvent(): any {
      const fakeNydus = nydus as unknown as FakeNydusServer
      return fakeNydus.publish.mock.calls.find(
        ([path, data]) => path === getSessionPath(user1.id, user2.id) && data?.action === 'message',
      )?.[1]
    }

    beforeEach(() => {
      rollOutcomeMock.mockReturnValue(ROLL)
    })

    test('stores and publishes an action line carrying the settled outcome', async () => {
      mockStoredOutcome('', ROLL)

      await whisperService.sendOutcome(user1.id, user2.id, { kind: 'roll', max: 6 })

      expect(rollOutcomeMock).toHaveBeenCalledWith({ kind: 'roll', max: 6 })
      expect(startWhisperSessionsBothDirections).toHaveBeenCalledWith(user1.id, user2.id)
      expect(addMessageToWhisperMock).toHaveBeenCalledWith(user1.id, user2.id, {
        type: WhisperMessageType.TextMessage,
        text: '',
        mentions: undefined,
        channelMentions: undefined,
        emote: true,
        outcome: ROLL,
      })
      expect(publishedMessageEvent()).toMatchObject({
        message: { text: '', emote: true, outcome: ROLL },
        users: [user1, user2],
        mentions: [],
        channelMentions: [],
      })
    })

    test('leaves the text empty for a coin flip', async () => {
      const flip: RolledOutcome = { kind: 'flip', result: 'tails' }
      rollOutcomeMock.mockReturnValue(flip)
      mockStoredOutcome('', flip)

      await whisperService.sendOutcome(user1.id, user2.id, { kind: 'flip' })

      expect(addMessageToWhisperMock.mock.calls[0][2]).toMatchObject({ text: '' })
      expect(publishedMessageEvent().message).toMatchObject({ text: '', outcome: flip })
    })

    test("advances the sender's read position like a text message does", async () => {
      const flip: RolledOutcome = { kind: 'flip', result: 'tails' }
      rollOutcomeMock.mockReturnValue(flip)
      mockStoredOutcome('', flip)

      await whisperService.sendOutcome(user1.id, user2.id, { kind: 'flip' })

      expect(updateLastReadTime).toHaveBeenCalledWith(
        user1.id,
        user2.id,
        new Date('2023-03-11T00:00:00.000Z'),
      )
    })

    test("carries the 8-ball's question as the text, unprocessed for mentions", async () => {
      const answer: RolledOutcome = { kind: 'eightBall', answer: 'itIsCertain' }
      const question = `should @${user3.name} pick the map?`
      rollOutcomeMock.mockReturnValue(answer)
      mockStoredOutcome(question, answer)

      await whisperService.sendOutcome(user1.id, user2.id, { kind: 'eightBall', question })

      expect(addMessageToWhisperMock).toHaveBeenCalledWith(user1.id, user2.id, {
        type: WhisperMessageType.TextMessage,
        text: question,
        mentions: undefined,
        channelMentions: undefined,
        emote: true,
        outcome: answer,
      })
      expect(publishedMessageEvent()).toMatchObject({ mentions: [], channelMentions: [] })
    })

    test('throws when whispering yourself', async () => {
      await expect(
        whisperService.sendOutcome(user1.id, user1.id, { kind: 'roll' }),
      ).rejects.toThrowErrorMatchingInlineSnapshot(`[Error: Can't whisper with yourself]`)
      expect(addMessageToWhisperMock).not.toHaveBeenCalled()
    })

    test('throws when the user is chat restricted', async () => {
      asMockedFunction(mockRestrictionService.isRestricted).mockResolvedValueOnce(true)

      await expect(
        whisperService.sendOutcome(user1.id, user2.id, { kind: 'roll' }),
      ).rejects.toThrowErrorMatchingInlineSnapshot(`[Error: User is chat restricted]`)
      expect(addMessageToWhisperMock).not.toHaveBeenCalled()
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

    test('uses an around cursor at the message time when aroundMessageId is given', async () => {
      const messageId = 'MESSAGE_ID'
      asMockedFunction(getWhisperMessageSentTime).mockResolvedValue(new Date(3000))

      await whisperService.getSessionHistory(
        user1.id,
        user2.id,
        50,
        undefined,
        undefined,
        undefined,
        messageId,
      )

      expect(getWhisperMessageSentTime).toHaveBeenCalledWith(user1.id, user2.id, messageId)
      expect(getMessagesForWhisperSession).toHaveBeenCalledWith(user1.id, user2.id, 50, {
        kind: 'around',
        date: new Date(3000),
      })
    })

    test('throws MessageNotFound when aroundMessageId names no message in this whisper', async () => {
      asMockedFunction(getWhisperMessageSentTime).mockResolvedValue(undefined)

      await expect(
        whisperService.getSessionHistory(
          user1.id,
          user2.id,
          50,
          undefined,
          undefined,
          undefined,
          'MESSAGE_ID',
        ),
      ).rejects.toMatchObject({ code: WhisperServiceErrorCode.MessageNotFound })
    })
  })

  describe('getMessageLinkTarget', () => {
    const messageId = 'MESSAGE_ID'

    test('resolves to the other participant when the requester sent the message', async () => {
      asMockedFunction(getWhisperMessageParticipants).mockResolvedValue({
        from: user1.id,
        to: user2.id,
      })

      const result = await whisperService.getMessageLinkTarget(user1.id, messageId)

      expect(result).toEqual({ targetId: user2.id, users: [user2] })
    })

    test('resolves to the other participant when the requester received the message', async () => {
      asMockedFunction(getWhisperMessageParticipants).mockResolvedValue({
        from: user2.id,
        to: user1.id,
      })

      const result = await whisperService.getMessageLinkTarget(user1.id, messageId)

      expect(result).toEqual({ targetId: user2.id, users: [user2] })
    })

    test('throws MessageNotFound when the requester is not a participant', async () => {
      asMockedFunction(getWhisperMessageParticipants).mockResolvedValue({
        from: user2.id,
        to: user3.id,
      })

      await expect(whisperService.getMessageLinkTarget(user1.id, messageId)).rejects.toMatchObject({
        code: WhisperServiceErrorCode.MessageNotFound,
      })
    })

    test('throws MessageNotFound when the message does not exist', async () => {
      asMockedFunction(getWhisperMessageParticipants).mockResolvedValue(undefined)

      await expect(whisperService.getMessageLinkTarget(user1.id, messageId)).rejects.toMatchObject({
        code: WhisperServiceErrorCode.MessageNotFound,
      })
    })
  })

  describe('socket lifecycle', () => {
    test('keeps the sessions of a user who reconnects right after quitting', async () => {
      // A user lookup slower than the session load: anything the quit handler awaited before
      // dropping the user's sessions would then land after the reconnect has repopulated them.
      const findUser = asMockedFunction(findUserById)
      const originalFindUser = findUser.getMockImplementation()
      findUser.mockImplementation(async id => {
        await new Promise(resolve => setTimeout(resolve, 10))
        return [user1, user2, user3].find(u => u.id === id)
      })
      asMockedFunction(getWhisperSessionsForUser).mockResolvedValue([
        { targetId: user1.id, lastReadTime: undefined, startDate: new Date(0) },
      ])

      try {
        const client = connector.connectClient(user2, 'USER2_CLIENT_ID')
        await new Promise(resolve => setTimeout(resolve, 20))

        client.disconnect()
        connector.connectClient(user2, 'USER2_CLIENT_ID')
        await new Promise(resolve => setTimeout(resolve, 40))

        await expect(whisperService.getSessionHistory(user2.id, user1.id)).resolves.toBeDefined()
      } finally {
        findUser.mockImplementation(originalFindUser!)
      }
    })
  })
})
