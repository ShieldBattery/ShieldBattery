import { NydusServer } from 'nydus'
import createDeferred from '../../../common/async/deferred'
import {
  ChannelInfo,
  ChannelModerationAction,
  ChannelPermissions,
  GetChannelHistoryServerResponse,
  makeSbChannelId,
  ServerChatMessageType,
} from '../../../common/chat'
import * as flags from '../../../common/flags'
import { asMockedFunction } from '../../../common/testing/mocks'
import { userPermissions } from '../../../common/users/permissions'
import { makeSbUserId, SbUser } from '../../../common/users/sb-user'
import { DbClient } from '../db'
import { getPermissions } from '../models/permissions'
import { MIN_IDENTIFIER_MATCHES } from '../users/client-ids'
import { findUserById, findUsersById, findUsersByName } from '../users/user-model'
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
  addMessageToChannel,
  addUserToChannel,
  banAllIdentifiersFromChannel,
  banUserFromChannel,
  ChatMessage,
  countBannedIdentifiersForChannel,
  createChannel,
  deleteChannelMessage,
  findChannelByName,
  getChannelInfo,
  getMessagesForChannel,
  getUserChannelEntryForUser,
  getUsersForChannel,
  isUserBannedFromChannel,
  JoinChannelData,
  removeUserFromChannel,
  TextMessageData,
  updateUserPermissions,
  UserChannelEntry,
} from './chat-models'
import ChatService, { getChannelPath, getChannelUserPath } from './chat-service'

const flagsMock = flags as { CAN_LEAVE_SHIELDBATTERY_CHANNEL: boolean }

jest.mock('../../../common/flags', () => ({
  __esModule: true,
  CAN_LEAVE_SHIELDBATTERY_CHANNEL: false,
}))

// NOTE(2Pac): We don't bother mocking this since all the DB methods are mocked already and we're
// not doing anything special with this in chat service except pass it as an argument to the model
// methods.
const dbClient = {} as DbClient

jest.mock('../db/transaction', () =>
  jest.fn(async next => {
    await next(dbClient)
  }),
)

jest.mock('../models/permissions')
jest.mock('../users/user-identifiers')
jest.mock('../users/user-model')
jest.mock('./chat-models', () => ({
  getChannelsForUser: jest.fn().mockResolvedValue([]),
  getUsersForChannel: jest.fn().mockResolvedValue([]),
  getUserChannelEntryForUser: jest.fn(),
  createChannel: jest.fn(),
  addUserToChannel: jest.fn(),
  addMessageToChannel: jest.fn(),
  getMessagesForChannel: jest.fn().mockResolvedValue([]),
  deleteChannelMessage: jest.fn(),
  removeUserFromChannel: jest.fn(),
  updateUserPermissions: jest.fn(),
  countBannedIdentifiersForChannel: jest.fn(),
  banUserFromChannel: jest.fn(),
  banAllIdentifiersFromChannel: jest.fn(),
  isUserBannedFromChannel: jest.fn(),
  getChannelInfo: jest.fn().mockResolvedValue([]),
  findChannelByName: jest.fn(),
  searchChannelsAsAdmin: jest.fn().mockResolvedValue([]),
}))

// TODO(2Pac): Move these elsewhere?

type DbJoinChannelMessage = ChatMessage & { data: JoinChannelData }
type DbTextChannelMessage = ChatMessage & { data: TextMessageData }

/**
 * A helper method that returns a JSON version of the "JoinChannel" database message.
 */
function toJoinChannelMessageJson(dbMessage: DbJoinChannelMessage) {
  return {
    id: dbMessage.msgId,
    type: dbMessage.data.type,
    channelId: dbMessage.channelId,
    userId: dbMessage.userId,
    time: Number(dbMessage.sent),
  }
}
/**
 * A helper method that returns a JSON version of the "Text" database message.
 */
function toTextMessageJson(dbMessage: DbTextChannelMessage) {
  return {
    id: dbMessage.msgId,
    type: dbMessage.data.type,
    channelId: dbMessage.channelId,
    from: dbMessage.userId,
    time: Number(dbMessage.sent),
    text: dbMessage.data.text,
  }
}

describe('chat/chat-service', () => {
  let nydus: NydusServer
  let chatService: ChatService
  let connector: NydusConnector

  const shieldBatteryChannel: ChannelInfo = {
    id: makeSbChannelId(1),
    name: 'ShieldBattery',
    private: false,
    official: true,
  }
  const testChannel: ChannelInfo = {
    id: makeSbChannelId(2),
    name: 'test',
    private: false,
    official: false,
  }

  const user1: SbUser = { id: makeSbUserId(1), name: 'USER_NAME_1' }
  const user2: SbUser = { id: makeSbUserId(2), name: 'USER_NAME_2' }

  const channelPermissions: ChannelPermissions = {
    kick: false,
    ban: false,
    changeTopic: false,
    togglePrivate: false,
    editPermissions: false,
  }
  const user1ShieldBatteryChannelEntry: UserChannelEntry = {
    userId: user1.id,
    channelId: shieldBatteryChannel.id,
    joinDate: new Date('2023-03-11T00:00:00.000Z'),
    channelPermissions,
  }
  const user1TestChannelEntry: UserChannelEntry = {
    userId: user1.id,
    channelId: testChannel.id,
    joinDate: new Date('2023-03-11T00:00:00.000Z'),
    channelPermissions,
  }
  const user2ShieldBatteryChannelEntry: UserChannelEntry = {
    userId: user2.id,
    channelId: shieldBatteryChannel.id,
    joinDate: new Date('2023-03-11T00:00:00.000Z'),
    channelPermissions,
  }
  const user2TestChannelEntry: UserChannelEntry = {
    userId: user2.id,
    channelId: testChannel.id,
    joinDate: new Date('2023-03-11T00:00:00.000Z'),
    channelPermissions,
  }

  const joinUser1ShieldBatteryChannelMessage: DbJoinChannelMessage = {
    msgId: 'MESSAGE_ID',
    userId: user1.id,
    userName: user1.name,
    channelId: shieldBatteryChannel.id,
    sent: new Date('2023-03-11T00:00:00.000Z'),
    data: {
      type: ServerChatMessageType.JoinChannel,
    },
  }
  const joinUser1TestChannelMessage: DbJoinChannelMessage = {
    msgId: 'MESSAGE_ID',
    userId: user1.id,
    userName: user1.name,
    channelId: testChannel.id,
    sent: new Date('2023-03-11T00:00:00.000Z'),
    data: {
      type: ServerChatMessageType.JoinChannel,
    },
  }
  const joinUser2ShieldBatteryChannelMessage: DbJoinChannelMessage = {
    msgId: 'MESSAGE_ID',
    userId: user2.id,
    userName: user2.name,
    channelId: shieldBatteryChannel.id,
    sent: new Date('2023-03-11T00:00:00.000Z'),
    data: {
      type: ServerChatMessageType.JoinChannel,
    },
  }
  const joinUser2TestChannelMessage: DbJoinChannelMessage = {
    msgId: 'MESSAGE_ID',
    userId: user2.id,
    userName: user2.name,
    channelId: testChannel.id,
    sent: new Date('2023-03-11T00:00:00.000Z'),
    data: {
      type: ServerChatMessageType.JoinChannel,
    },
  }

  /**
   * A helper method that mocks everything correctly to "join" a user to a channel.
   */
  async function joinUserToChannel(
    user: SbUser,
    channel: ChannelInfo,
    userChannelEntry: UserChannelEntry,
    channelMessage: ChatMessage,
  ) {
    asMockedFunction(findUserById).mockResolvedValue(user)
    asMockedFunction(findChannelByName).mockResolvedValue(undefined)
    asMockedFunction(createChannel).mockResolvedValue(channel)
    asMockedFunction(addUserToChannel).mockResolvedValue(userChannelEntry)
    asMockedFunction(addMessageToChannel).mockResolvedValue(channelMessage)

    await chatService.joinChannel(testChannel.name, user1.id)
  }

  const USER1_CLIENT_ID = 'USER1_CLIENT_ID'
  const USER2_CLIENT_ID = 'USER2_CLIENT_ID'

  let client1: InspectableNydusClient
  let client2: InspectableNydusClient

  beforeEach(() => {
    nydus = createFakeNydusServer()
    const sessionLookup = new RequestSessionLookup()
    const userSocketsManager = new UserSocketsManager(nydus, sessionLookup, async () => {})
    const publisher = new TypedPublisher(nydus)

    chatService = new ChatService(publisher, userSocketsManager)
    connector = new NydusConnector(nydus, sessionLookup)

    client1 = connector.connectClient(user1, USER1_CLIENT_ID)
    client2 = connector.connectClient(user2, USER2_CLIENT_ID)

    jest.clearAllMocks()
    clearTestLogs(nydus)
  })

  describe('joinInitialChannel', () => {
    const addUserToChannelMock = asMockedFunction(addUserToChannel)
    const addMessageToChannelMock = asMockedFunction(addMessageToChannel)

    beforeEach(async () => {
      // NOTE(2Pac): We pre-join user2 to the channel so we can check it sees correct websocket
      // messages from user1 joining initially.
      await joinUserToChannel(
        user2,
        shieldBatteryChannel,
        user2ShieldBatteryChannelEntry,
        joinUser2ShieldBatteryChannelMessage,
      )

      asMockedFunction(findUserById).mockResolvedValue(user1)
      asMockedFunction(getChannelInfo).mockResolvedValue([shieldBatteryChannel])
      addUserToChannelMock.mockResolvedValue(user1ShieldBatteryChannelEntry)
      addMessageToChannelMock.mockResolvedValue(joinUser1ShieldBatteryChannelMessage)
    })

    test("should throw if user doesn't exist", async () => {
      asMockedFunction(findUserById).mockResolvedValue(undefined)

      await expect(
        chatService.joinInitialChannel(user1.id, dbClient, Promise.resolve()),
      ).rejects.toThrowErrorMatchingInlineSnapshot(`"User doesn't exist"`)
    })

    test('works when user exists', async () => {
      const transactionPromise = createDeferred<void>()

      await chatService.joinInitialChannel(user1.id, dbClient, transactionPromise)

      expect(addUserToChannelMock).toHaveBeenCalledWith(user1.id, shieldBatteryChannel.id, dbClient)
      expect(addMessageToChannelMock).toHaveBeenCalledWith(
        user1.id,
        shieldBatteryChannel.id,
        { type: ServerChatMessageType.JoinChannel },
        dbClient,
      )

      await transactionPromise.resolve()

      expect(client2.publish).toHaveBeenCalledWith(getChannelPath(shieldBatteryChannel.id), {
        action: 'join2',
        user: user1,
        message: toJoinChannelMessageJson(joinUser1ShieldBatteryChannelMessage),
      })
      expect(client1.publish).toHaveBeenCalledWith(getChannelPath(shieldBatteryChannel.id), {
        action: 'init3',
        channelInfo: shieldBatteryChannel,
        activeUserIds: [user2.id, user1.id],
        selfPermissions: channelPermissions,
      })
      expect(nydus.subscribeClient).toHaveBeenCalledWith(
        client1,
        getChannelUserPath(shieldBatteryChannel.id, user1.id),
        undefined,
      )
    })
  })

  describe('joinChannel', () => {
    const addUserToChannelMock = asMockedFunction(addUserToChannel)
    const addMessageToChannelMock = asMockedFunction(addMessageToChannel)
    const createChannelMock = asMockedFunction(createChannel)

    beforeEach(async () => {
      // NOTE(2Pac): We pre-join user2 to the channel so we can check it sees correct websocket
      // messages from user1 joining.
      await joinUserToChannel(
        user2,
        shieldBatteryChannel,
        user2ShieldBatteryChannelEntry,
        joinUser2ShieldBatteryChannelMessage,
      )

      asMockedFunction(findUserById).mockResolvedValue(user1)
      asMockedFunction(findChannelByName).mockResolvedValue(shieldBatteryChannel)
      asMockedFunction(getUserChannelEntryForUser).mockResolvedValue(null)
      asMockedFunction(isUserBannedFromChannel).mockResolvedValue(false)
      asMockedFunction(countBannedIdentifiersForChannel).mockResolvedValue(0)
      addUserToChannelMock.mockResolvedValue(user1ShieldBatteryChannelEntry)
      addMessageToChannelMock.mockResolvedValue(joinUser1ShieldBatteryChannelMessage)
      createChannelMock.mockResolvedValue(shieldBatteryChannel)
    })

    test("should throw if user doesn't exist", async () => {
      asMockedFunction(findUserById).mockResolvedValue(undefined)

      await expect(
        chatService.joinChannel(shieldBatteryChannel.name, user1.id),
      ).rejects.toThrowErrorMatchingInlineSnapshot(`"User doesn't exist"`)
    })

    test('should throw if user is banned', async () => {
      asMockedFunction(isUserBannedFromChannel).mockResolvedValue(true)

      await expect(
        chatService.joinChannel(shieldBatteryChannel.name, user1.id),
      ).rejects.toThrowErrorMatchingInlineSnapshot(`"User is banned"`)
    })

    test('should throw if smurf account is banned', async () => {
      asMockedFunction(countBannedIdentifiersForChannel).mockResolvedValue(
        MIN_IDENTIFIER_MATCHES + 1,
      )

      await expect(
        chatService.joinChannel(shieldBatteryChannel.name, user1.id),
      ).rejects.toThrowErrorMatchingInlineSnapshot(`"User is banned"`)
    })

    test('works when channel already exists', async () => {
      await chatService.joinChannel(shieldBatteryChannel.name, user1.id)

      expect(addUserToChannelMock).toHaveBeenCalledWith(user1.id, shieldBatteryChannel.id, dbClient)
      expect(addMessageToChannelMock).toHaveBeenCalledWith(
        user1.id,
        shieldBatteryChannel.id,
        { type: ServerChatMessageType.JoinChannel },
        dbClient,
      )
      expect(client2.publish).toHaveBeenCalledWith(getChannelPath(shieldBatteryChannel.id), {
        action: 'join2',
        user: user1,
        message: toJoinChannelMessageJson(joinUser1ShieldBatteryChannelMessage),
      })
      expect(client1.publish).toHaveBeenCalledWith(getChannelPath(shieldBatteryChannel.id), {
        action: 'init3',
        channelInfo: shieldBatteryChannel,
        activeUserIds: [user2.id, user1.id],
        selfPermissions: channelPermissions,
      })
      expect(nydus.subscribeClient).toHaveBeenCalledWith(
        client1,
        getChannelUserPath(shieldBatteryChannel.id, user1.id),
        undefined,
      )
    })

    test("creates a new channel when it doesn't exist", async () => {
      asMockedFunction(findChannelByName).mockResolvedValue(undefined)
      addUserToChannelMock.mockResolvedValue(user1TestChannelEntry)
      addMessageToChannelMock.mockResolvedValue(joinUser1TestChannelMessage)
      createChannelMock.mockResolvedValue(testChannel)

      await chatService.joinChannel(testChannel.name, user1.id)

      expect(createChannelMock).toHaveBeenCalledWith(user1.id, testChannel.name, dbClient)
      expect(addUserToChannelMock).toHaveBeenCalledWith(user1.id, testChannel.id, dbClient)
      expect(addMessageToChannelMock).toHaveBeenCalledWith(
        user1.id,
        testChannel.id,
        { type: ServerChatMessageType.JoinChannel },
        dbClient,
      )

      // NOTE(2Pac): Since there are no users in this channel, we don't bother checking to see if
      // the publish message was sent/received.

      expect(client1.publish).toHaveBeenCalledWith(getChannelPath(testChannel.id), {
        action: 'init3',
        channelInfo: testChannel,
        activeUserIds: [user1.id],
        selfPermissions: channelPermissions,
      })
      expect(nydus.subscribeClient).toHaveBeenCalledWith(
        client1,
        getChannelUserPath(testChannel.id, user1.id),
        undefined,
      )
    })
  })

  describe('leaveChannel', () => {
    const removeUserFromChannelMock = asMockedFunction(removeUserFromChannel)

    beforeEach(async () => {
      removeUserFromChannelMock.mockResolvedValue({ newOwnerId: undefined })
    })

    test('should throw if not in channel', async () => {
      await expect(
        chatService.leaveChannel(testChannel.id, user1.id),
      ).rejects.toThrowErrorMatchingInlineSnapshot(`"Must be in channel to leave it"`)
    })

    describe('when in ShieldBattery channel', () => {
      beforeEach(async () => {
        await joinUserToChannel(
          user1,
          shieldBatteryChannel,
          user1ShieldBatteryChannelEntry,
          joinUser1ShieldBatteryChannelMessage,
        )
        await joinUserToChannel(
          user2,
          shieldBatteryChannel,
          user2ShieldBatteryChannelEntry,
          joinUser2ShieldBatteryChannelMessage,
        )
      })

      test("should throw if it's not allowed", async () => {
        flagsMock.CAN_LEAVE_SHIELDBATTERY_CHANNEL = false

        await expect(
          chatService.leaveChannel(shieldBatteryChannel.id, user1.id),
        ).rejects.toThrowErrorMatchingInlineSnapshot(`"Can't leave ShieldBattery channel"`)
      })

      test("works when it's allowed", async () => {
        flagsMock.CAN_LEAVE_SHIELDBATTERY_CHANNEL = true

        await chatService.leaveChannel(shieldBatteryChannel.id, user1.id)

        expect(removeUserFromChannelMock).toHaveBeenCalledWith(user1.id, shieldBatteryChannel.id)
        expect(client2.publish).toHaveBeenCalledWith(getChannelPath(shieldBatteryChannel.id), {
          action: 'leave2',
          userId: user1.id,
          newOwnerId: undefined,
        })
        expect(client1.unsubscribe).toHaveBeenCalledWith(getChannelPath(shieldBatteryChannel.id))
        expect(client1.unsubscribe).toHaveBeenCalledWith(
          getChannelUserPath(shieldBatteryChannel.id, user1.id),
        )
      })
    })

    test('works when in non-ShieldBattery channel', async () => {
      await joinUserToChannel(
        user1,
        testChannel,
        user1TestChannelEntry,
        joinUser1TestChannelMessage,
      )
      await joinUserToChannel(
        user2,
        testChannel,
        user2TestChannelEntry,
        joinUser2TestChannelMessage,
      )

      await chatService.leaveChannel(testChannel.id, user1.id)

      expect(removeUserFromChannelMock).toHaveBeenCalledWith(user1.id, testChannel.id)
      expect(client2.publish).toHaveBeenCalledWith(getChannelPath(testChannel.id), {
        action: 'leave2',
        userId: user1.id,
        newOwnerId: undefined,
      })
      expect(client1.unsubscribe).toHaveBeenCalledWith(getChannelPath(testChannel.id))
      expect(client1.unsubscribe).toHaveBeenCalledWith(getChannelUserPath(testChannel.id, user1.id))
    })
  })

  describe('moderateUser', () => {
    const removeUserFromChannelMock = asMockedFunction(removeUserFromChannel)

    beforeEach(async () => {
      removeUserFromChannelMock.mockResolvedValue({ newOwnerId: undefined })
    })

    test('should throw if not in channel', async () => {
      await expect(
        chatService.moderateUser(testChannel.id, user1.id, user2.id, ChannelModerationAction.Kick),
      ).rejects.toThrowErrorMatchingInlineSnapshot(`"Must be in channel to moderate users"`)
    })

    test('should throw if target user not in channel', async () => {
      asMockedFunction(getUserChannelEntryForUser)
        .mockResolvedValueOnce(user1TestChannelEntry)
        .mockResolvedValueOnce(null)

      await expect(
        chatService.moderateUser(testChannel.id, user1.id, user2.id, ChannelModerationAction.Kick),
      ).rejects.toThrowErrorMatchingInlineSnapshot(`"User must be in channel to moderate them"`)
    })

    test('should throw if moderating yourself', async () => {
      asMockedFunction(getUserChannelEntryForUser).mockResolvedValue(user1TestChannelEntry)

      await expect(
        chatService.moderateUser(testChannel.id, user1.id, user1.id, ChannelModerationAction.Kick),
      ).rejects.toThrowErrorMatchingInlineSnapshot(`"Can't moderate yourself"`)
    })

    describe('when moderating ShieldBattery channel', () => {
      beforeEach(async () => {
        await joinUserToChannel(
          user1,
          shieldBatteryChannel,
          user1ShieldBatteryChannelEntry,
          joinUser1ShieldBatteryChannelMessage,
        )
        await joinUserToChannel(
          user2,
          shieldBatteryChannel,
          user2ShieldBatteryChannelEntry,
          joinUser2ShieldBatteryChannelMessage,
        )

        asMockedFunction(getChannelInfo).mockResolvedValue([shieldBatteryChannel])
        asMockedFunction(getPermissions).mockResolvedValue({
          ...userPermissions,
          moderateChatChannels: true,
        })
        asMockedFunction(getUserChannelEntryForUser)
          .mockResolvedValueOnce(user1ShieldBatteryChannelEntry)
          .mockResolvedValueOnce(user2ShieldBatteryChannelEntry)
      })

      test("should throw if it's not allowed", async () => {
        flagsMock.CAN_LEAVE_SHIELDBATTERY_CHANNEL = false

        await expect(
          chatService.moderateUser(
            shieldBatteryChannel.id,
            user1.id,
            user2.id,
            ChannelModerationAction.Kick,
          ),
        ).rejects.toThrowErrorMatchingInlineSnapshot(
          `"Can't moderate users in the ShieldBattery channel"`,
        )
      })

      test("works when it's allowed", async () => {
        flagsMock.CAN_LEAVE_SHIELDBATTERY_CHANNEL = true

        await chatService.moderateUser(
          shieldBatteryChannel.id,
          user1.id,
          user2.id,
          ChannelModerationAction.Kick,
        )

        expect(removeUserFromChannelMock).toHaveBeenCalledWith(user2.id, shieldBatteryChannel.id)
        expect(client1.publish).toHaveBeenCalledWith(getChannelPath(shieldBatteryChannel.id), {
          action: ChannelModerationAction.Kick,
          targetId: user2.id,
          newOwnerId: undefined,
        })
        expect(client2.unsubscribe).toHaveBeenCalledWith(getChannelPath(shieldBatteryChannel.id))
        expect(client2.unsubscribe).toHaveBeenCalledWith(
          getChannelUserPath(shieldBatteryChannel.id, user2.id),
        )
      })
    })

    describe('when moderating non-ShieldBattery channel', () => {
      const expectItWorks = () => {
        expect(removeUserFromChannelMock).toHaveBeenCalledWith(user2.id, testChannel.id)
        expect(client1.publish).toHaveBeenCalledWith(getChannelPath(testChannel.id), {
          action: ChannelModerationAction.Kick,
          targetId: user2.id,
          newOwnerId: undefined,
        })
        expect(client2.unsubscribe).toHaveBeenCalledWith(getChannelPath(testChannel.id))
        expect(client2.unsubscribe).toHaveBeenCalledWith(
          getChannelUserPath(testChannel.id, user2.id),
        )
      }

      beforeEach(async () => {
        await joinUserToChannel(
          user1,
          testChannel,
          user1TestChannelEntry,
          joinUser1TestChannelMessage,
        )
        await joinUserToChannel(
          user2,
          testChannel,
          user2TestChannelEntry,
          joinUser2TestChannelMessage,
        )

        asMockedFunction(getChannelInfo).mockResolvedValue([testChannel])
        asMockedFunction(getPermissions).mockResolvedValue(userPermissions)
      })

      test('should throw if not enough permissions to moderate channel owners', async () => {
        asMockedFunction(getChannelInfo).mockResolvedValue([
          {
            ...testChannel,
            joinedChannelData: {
              topic: 'CHANNEL_TOPIC',
              ownerId: user2.id,
            },
          },
        ])
        asMockedFunction(getUserChannelEntryForUser)
          .mockResolvedValueOnce(user1TestChannelEntry)
          .mockResolvedValueOnce(user2TestChannelEntry)

        await expect(
          chatService.moderateUser(
            testChannel.id,
            user1.id,
            user2.id,
            ChannelModerationAction.Kick,
          ),
        ).rejects.toThrowErrorMatchingInlineSnapshot(
          `"Only server moderators can moderate channel owners"`,
        )
      })

      test('should throw if not enough permissions to moderate channel moderators', async () => {
        asMockedFunction(getUserChannelEntryForUser)
          .mockResolvedValueOnce(user1TestChannelEntry)
          .mockResolvedValueOnce({
            ...user2TestChannelEntry,
            channelPermissions: { ...channelPermissions, editPermissions: true },
          })

        await expect(
          chatService.moderateUser(
            testChannel.id,
            user1.id,
            user2.id,
            ChannelModerationAction.Kick,
          ),
        ).rejects.toThrowErrorMatchingInlineSnapshot(
          `"Only server moderators and channel owners can moderate channel moderators"`,
        )
      })

      test('should throw if not enough permissions to moderate the user', async () => {
        asMockedFunction(getUserChannelEntryForUser)
          .mockResolvedValueOnce(user1TestChannelEntry)
          .mockResolvedValueOnce(user2TestChannelEntry)

        await expect(
          chatService.moderateUser(
            testChannel.id,
            user1.id,
            user2.id,
            ChannelModerationAction.Kick,
          ),
        ).rejects.toThrowErrorMatchingInlineSnapshot(
          `"Not enough permissions to moderate the user"`,
        )
      })

      describe('when user is server moderator', () => {
        beforeEach(() => {
          asMockedFunction(getPermissions).mockResolvedValue({
            ...userPermissions,
            moderateChatChannels: true,
          })
        })

        test('works when target is channel owner', async () => {
          asMockedFunction(getChannelInfo).mockResolvedValue([
            {
              ...testChannel,
              joinedChannelData: {
                topic: 'CHANNEL_TOPIC',
                ownerId: user2.id,
              },
            },
          ])
          asMockedFunction(getUserChannelEntryForUser)
            .mockResolvedValueOnce(user1TestChannelEntry)
            .mockResolvedValueOnce(user2TestChannelEntry)

          await chatService.moderateUser(
            testChannel.id,
            user1.id,
            user2.id,
            ChannelModerationAction.Kick,
          )

          expectItWorks()
        })

        test('works when target is channel moderator', async () => {
          asMockedFunction(getUserChannelEntryForUser)
            .mockResolvedValueOnce(user1TestChannelEntry)
            .mockResolvedValueOnce({
              ...user2TestChannelEntry,
              channelPermissions: { ...channelPermissions, editPermissions: true },
            })

          await chatService.moderateUser(
            testChannel.id,
            user1.id,
            user2.id,
            ChannelModerationAction.Kick,
          )

          expectItWorks()
        })

        test('works when target is regular user', async () => {
          asMockedFunction(getUserChannelEntryForUser)
            .mockResolvedValueOnce(user1TestChannelEntry)
            .mockResolvedValueOnce(user2TestChannelEntry)

          await chatService.moderateUser(
            testChannel.id,
            user1.id,
            user2.id,
            ChannelModerationAction.Kick,
          )

          expectItWorks()
        })
      })

      describe('when user is channel owner', () => {
        beforeEach(() => {
          asMockedFunction(getChannelInfo).mockResolvedValue([
            {
              ...testChannel,
              joinedChannelData: {
                topic: 'CHANNEL_TOPIC',
                ownerId: user1.id,
              },
            },
          ])
        })

        test('works when target is channel moderator', async () => {
          asMockedFunction(getUserChannelEntryForUser)
            .mockResolvedValueOnce(user1TestChannelEntry)
            .mockResolvedValueOnce({
              ...user2TestChannelEntry,
              channelPermissions: { ...channelPermissions, editPermissions: true },
            })

          await chatService.moderateUser(
            testChannel.id,
            user1.id,
            user2.id,
            ChannelModerationAction.Kick,
          )

          expectItWorks()
        })

        test('works when target is regular user', async () => {
          asMockedFunction(getUserChannelEntryForUser)
            .mockResolvedValueOnce(user1TestChannelEntry)
            .mockResolvedValueOnce(user2TestChannelEntry)

          await chatService.moderateUser(
            testChannel.id,
            user1.id,
            user2.id,
            ChannelModerationAction.Kick,
          )

          expectItWorks()
        })
      })

      describe('when user is channel moderator', () => {
        beforeEach(() => {
          asMockedFunction(getUserChannelEntryForUser)
            .mockResolvedValueOnce({
              ...user1TestChannelEntry,
              channelPermissions: { ...channelPermissions, editPermissions: true },
            })
            .mockResolvedValueOnce(user2TestChannelEntry)
        })

        test('works when target is regular user', async () => {
          await chatService.moderateUser(
            testChannel.id,
            user1.id,
            user2.id,
            ChannelModerationAction.Kick,
          )

          expectItWorks()
        })
      })

      test('should ban user if moderation action is "Ban"', async () => {
        const banUserFromChannelMock = asMockedFunction(banUserFromChannel)
        const banAllIdentifiersFromChannelMock = asMockedFunction(banAllIdentifiersFromChannel)

        asMockedFunction(getPermissions).mockResolvedValue({
          ...userPermissions,
          moderateChatChannels: true,
        })
        asMockedFunction(getUserChannelEntryForUser)
          .mockResolvedValueOnce(user1TestChannelEntry)
          .mockResolvedValueOnce(user2TestChannelEntry)

        await chatService.moderateUser(
          testChannel.id,
          user1.id,
          user2.id,
          ChannelModerationAction.Ban,
          'MODERATION_REASON',
        )

        expect(banUserFromChannelMock).toHaveBeenCalledWith(
          {
            channelId: testChannel.id,
            moderatorId: user1.id,
            targetId: user2.id,
            reason: 'MODERATION_REASON',
          },
          dbClient,
        )
        expect(banAllIdentifiersFromChannelMock).toHaveBeenCalledWith(
          {
            channelId: testChannel.id,
            targetId: user2.id,
          },
          dbClient,
        )
      })
    })
  })

  describe('sendChatMessage', () => {
    test('should throw if not in channel', async () => {
      await expect(
        chatService.sendChatMessage(testChannel.id, user1.id, 'Hello World!'),
      ).rejects.toThrowErrorMatchingInlineSnapshot(`"Must be in a channel to send a message to it"`)
    })

    describe('when in channel', () => {
      const addMessageToChannelMock = asMockedFunction(addMessageToChannel)

      let textMessage: DbTextChannelMessage
      const mockTextMessage = (processedMessageString: string, mentions: SbUser[]) => {
        textMessage = {
          msgId: 'MESSAGE_ID',
          userId: user1.id,
          userName: user1.name,
          channelId: testChannel.id,
          sent: new Date('2023-03-11T00:00:00.000Z'),
          data: {
            type: ServerChatMessageType.TextMessage,
            text: processedMessageString,
            mentions: mentions.map(m => m.id),
          },
        }
        // NOTE(2Pac): The `joinUserToChannel` calls already mock the return value of this function,
        // so we use the `mockResolvedValueOnce` method to bump the return value to the top of the
        // call stack.
        addMessageToChannelMock.mockResolvedValueOnce(textMessage)
        asMockedFunction(findUsersByName).mockResolvedValue(new Map(mentions.map(m => [m.name, m])))
      }

      const expectItWorks = (processedMessageString: string, mentions: SbUser[]) => {
        expect(addMessageToChannelMock).toHaveBeenCalledWith(user1.id, testChannel.id, {
          type: textMessage.data.type,
          text: processedMessageString,
          mentions: mentions.map(m => m.id),
        })
        expect(client2.publish).toHaveBeenCalledWith(getChannelPath(testChannel.id), {
          action: 'message2',
          message: toTextMessageJson(textMessage),
          user: {
            id: user1.id,
            name: user1.name,
          },
          mentions,
        })
      }

      beforeEach(async () => {
        await joinUserToChannel(
          user1,
          testChannel,
          user1TestChannelEntry,
          joinUser1TestChannelMessage,
        )
        await joinUserToChannel(
          user2,
          testChannel,
          user2TestChannelEntry,
          joinUser2TestChannelMessage,
        )
      })

      test('works for regular text messages', async () => {
        const messageString = 'Hello World!'
        mockTextMessage(messageString, [])

        await chatService.sendChatMessage(testChannel.id, user1.id, messageString)

        expectItWorks(messageString, [])
      })

      test('works when there are user mentions in message', async () => {
        const messageString = `Hello @${user1.name}, @${user2.name}, and @unknown.`
        const processedText = `Hello <@${user1.id}>, <@${user2.id}>, and @unknown.`
        const mentions = [user1, user2]
        mockTextMessage(processedText, mentions)

        await chatService.sendChatMessage(testChannel.id, user1.id, messageString)

        expectItWorks(processedText, mentions)
      })
    })
  })

  describe('deleteMessage', () => {
    test('should throw if not an admin', async () => {
      await expect(
        chatService.deleteMessage({
          channelId: testChannel.id,
          messageId: 'MESSAGE_ID',
          userId: user1.id,
          isAdmin: false,
        }),
      ).rejects.toThrowErrorMatchingInlineSnapshot(`"Not enough permissions to delete a message"`)
    })

    test('works when an admin', async () => {
      await joinUserToChannel(
        user1,
        testChannel,
        user1TestChannelEntry,
        joinUser1TestChannelMessage,
      )

      const messageId = 'MESSAGE_ID'
      const deleteChannelMessageMock = asMockedFunction(deleteChannelMessage)

      await chatService.deleteMessage({
        channelId: testChannel.id,
        messageId,
        userId: user1.id,
        isAdmin: true,
      })

      expect(deleteChannelMessageMock).toHaveBeenCalledWith(messageId, testChannel.id)
      expect(client1.publish).toHaveBeenCalledWith(getChannelPath(testChannel.id), {
        action: 'messageDeleted',
        messageId,
      })
    })
  })

  describe('getChannelInfo', () => {
    test('should throw if channel not found', async () => {
      asMockedFunction(getChannelInfo).mockResolvedValue([])

      await expect(
        chatService.getChannelInfo(testChannel.id, user1.id),
      ).rejects.toThrowErrorMatchingInlineSnapshot(`"Channel not found"`)
    })

    test('returns channel info when found', async () => {
      asMockedFunction(getChannelInfo).mockResolvedValue([testChannel])
      asMockedFunction(getUsersForChannel).mockResolvedValue([user1, user2])

      const result = await chatService.getChannelInfo(testChannel.id, user1.id)

      expect(result).toEqual({
        id: testChannel.id,
        name: testChannel.name,
        private: testChannel.private,
        official: testChannel.official,
        userCount: 2,
      })
    })

    describe('when channel is private', () => {
      beforeEach(() => {
        asMockedFunction(getChannelInfo).mockResolvedValue([{ ...testChannel, private: true }])
        asMockedFunction(getUsersForChannel).mockResolvedValue([user1, user2])
      })

      test("doesn't return user count", async () => {
        const result = await chatService.getChannelInfo(testChannel.id, user1.id)

        expect(result).toEqual({
          id: testChannel.id,
          name: testChannel.name,
          private: true,
          official: testChannel.official,
        })
      })

      test('returns user count if user is in channel', async () => {
        await joinUserToChannel(
          user1,
          testChannel,
          user1TestChannelEntry,
          joinUser1TestChannelMessage,
        )

        const result = await chatService.getChannelInfo(testChannel.id, user1.id)

        expect(result).toEqual({
          id: testChannel.id,
          name: testChannel.name,
          private: true,
          official: testChannel.official,
          userCount: 2,
        })
      })
    })
  })

  describe('getChannelHistory', () => {
    const textMessage1: DbTextChannelMessage = {
      msgId: 'MESSAGE_1_ID',
      userId: user1.id,
      userName: user1.name,
      channelId: testChannel.id,
      sent: new Date('2023-03-11T00:00:00.000Z'),
      data: {
        type: ServerChatMessageType.TextMessage,
        text: 'Hello World!',
      },
    }
    const textMessage2: DbTextChannelMessage = {
      msgId: 'MESSAGE_2_ID',
      userId: user1.id,
      userName: user1.name,
      channelId: testChannel.id,
      sent: new Date('2023-03-11T00:00:00.000Z'),
      data: {
        type: ServerChatMessageType.TextMessage,
        text: `Hello <@${user1.id}>, <@${user2.id}>, and @unknown.`,
        mentions: [user1.id, user2.id],
      },
    }

    const mockTextMessages = () => {
      asMockedFunction(getMessagesForChannel).mockResolvedValue([
        joinUser1TestChannelMessage,
        textMessage1,
        textMessage2,
      ])
      asMockedFunction(findUsersById).mockResolvedValue([user1, user2])
    }
    const expectItWorks = (result: GetChannelHistoryServerResponse) => {
      expect(result).toEqual({
        messages: [
          toJoinChannelMessageJson(joinUser1TestChannelMessage),
          toTextMessageJson(textMessage1),
          toTextMessageJson(textMessage2),
        ],
        users: [user1, user1, user1],
        mentions: [user1, user2],
      })
    }

    describe('when an admin', () => {
      test('works when not in channel', async () => {
        mockTextMessages()

        const result = await chatService.getChannelHistory({
          channelId: testChannel.id,
          userId: user1.id,
          isAdmin: true,
        })

        expectItWorks(result)
      })

      test('works when in channel', async () => {
        await joinUserToChannel(
          user1,
          testChannel,
          user1TestChannelEntry,
          joinUser1TestChannelMessage,
        )

        mockTextMessages()

        const result = await chatService.getChannelHistory({
          channelId: testChannel.id,
          userId: user1.id,
          isAdmin: true,
        })

        expectItWorks(result)
      })
    })

    describe('when not an admin', () => {
      test('should throw when not in channel', async () => {
        await expect(
          chatService.getChannelHistory({
            channelId: testChannel.id,
            userId: user1.id,
            isAdmin: false,
          }),
        ).rejects.toThrowErrorMatchingInlineSnapshot(
          `"Must be in a channel to retrieve message history"`,
        )
      })

      test('works when in channel', async () => {
        await joinUserToChannel(
          user1,
          testChannel,
          user1TestChannelEntry,
          joinUser1TestChannelMessage,
        )

        mockTextMessages()

        const result = await chatService.getChannelHistory({
          channelId: testChannel.id,
          userId: user1.id,
          isAdmin: false,
        })

        expectItWorks(result)
      })
    })
  })

  describe('getChannelUsers', () => {
    beforeEach(() => {
      asMockedFunction(getUsersForChannel).mockResolvedValue([user1, user2])
    })

    describe('when an admin', () => {
      test('works when not in channel', async () => {
        const result = await chatService.getChannelUsers({
          channelId: testChannel.id,
          userId: user1.id,
          isAdmin: true,
        })

        expect(result).toEqual([user1, user2])
      })

      test('works when in channel', async () => {
        await joinUserToChannel(
          user1,
          testChannel,
          user1TestChannelEntry,
          joinUser1TestChannelMessage,
        )

        const result = await chatService.getChannelUsers({
          channelId: testChannel.id,
          userId: user1.id,
          isAdmin: true,
        })

        expect(result).toEqual([user1, user2])
      })
    })

    describe('when not an admin', () => {
      test('should throw when not in channel', async () => {
        await expect(
          chatService.getChannelUsers({
            channelId: testChannel.id,
            userId: user1.id,
            isAdmin: false,
          }),
        ).rejects.toThrowErrorMatchingInlineSnapshot(`"Must be in a channel to retrieve user list"`)
      })

      test('works when in channel', async () => {
        await joinUserToChannel(
          user1,
          testChannel,
          user1TestChannelEntry,
          joinUser1TestChannelMessage,
        )

        const result = await chatService.getChannelUsers({
          channelId: testChannel.id,
          userId: user1.id,
          isAdmin: false,
        })

        expect(result).toEqual([user1, user2])
      })
    })
  })

  describe('getChatUserProfile', () => {
    test('should throw when not in channel', async () => {
      await expect(
        chatService.getChatUserProfile(testChannel.id, user1.id, user2.id),
      ).rejects.toThrowErrorMatchingInlineSnapshot(
        `"Must be in a channel to retrieve user profile"`,
      )
    })

    test('works when target user is not in channel', async () => {
      await joinUserToChannel(
        user1,
        testChannel,
        user1TestChannelEntry,
        joinUser1TestChannelMessage,
      )

      asMockedFunction(getUserChannelEntryForUser).mockResolvedValue(null)

      const result = await chatService.getChatUserProfile(testChannel.id, user1.id, user2.id)

      expect(result).toEqual({
        userId: user2.id,
        channelId: testChannel.id,
      })
    })

    test('works when target user is in channel', async () => {
      await joinUserToChannel(
        user1,
        testChannel,
        user1TestChannelEntry,
        joinUser1TestChannelMessage,
      )
      await joinUserToChannel(
        user2,
        testChannel,
        user2TestChannelEntry,
        joinUser2TestChannelMessage,
      )

      asMockedFunction(getUserChannelEntryForUser).mockResolvedValue(user2TestChannelEntry)
      asMockedFunction(getChannelInfo).mockResolvedValue([testChannel])

      const result = await chatService.getChatUserProfile(testChannel.id, user1.id, user2.id)

      expect(result).toEqual({
        userId: user2TestChannelEntry.userId,
        channelId: user2TestChannelEntry.channelId,
        profile: {
          userId: user2TestChannelEntry.userId,
          channelId: user2TestChannelEntry.channelId,
          joinDate: Number(user2TestChannelEntry.joinDate),
          isModerator: false,
        },
      })
    })
  })

  describe('getUserPermissions', () => {
    test('should throw if not in channel', async () => {
      asMockedFunction(getUserChannelEntryForUser).mockResolvedValueOnce(null)

      await expect(
        chatService.getUserPermissions(testChannel.id, user1.id, user2.id),
      ).rejects.toThrowErrorMatchingInlineSnapshot(`"Must be in channel to get user's permissions"`)
    })

    test('should throw if target user not in channel', async () => {
      asMockedFunction(getUserChannelEntryForUser)
        .mockResolvedValueOnce(user1TestChannelEntry)
        .mockResolvedValueOnce(null)

      await expect(
        chatService.getUserPermissions(testChannel.id, user1.id, user2.id),
      ).rejects.toThrowErrorMatchingInlineSnapshot(
        `"User must be in channel to get their permissions"`,
      )
    })

    test('should throw if not enough permissions', async () => {
      asMockedFunction(getUserChannelEntryForUser)
        .mockResolvedValueOnce(user1TestChannelEntry)
        .mockResolvedValueOnce(user2TestChannelEntry)

      await expect(
        chatService.getUserPermissions(testChannel.id, user1.id, user2.id),
      ).rejects.toThrowErrorMatchingInlineSnapshot(
        `"You don't have enough permissions to get other user's permissions"`,
      )
    })

    test('works when channel owner', async () => {
      asMockedFunction(getChannelInfo).mockResolvedValue([
        { ...testChannel, joinedChannelData: { topic: 'CHANNEL_TOPIC', ownerId: user1.id } },
      ])
      asMockedFunction(getUserChannelEntryForUser)
        .mockResolvedValueOnce(user1TestChannelEntry)
        .mockResolvedValueOnce(user2TestChannelEntry)

      const result = await chatService.getUserPermissions(testChannel.id, user1.id, user2.id)

      expect(result).toEqual({
        userId: user2TestChannelEntry.userId,
        channelId: user2TestChannelEntry.channelId,
        permissions: user2TestChannelEntry.channelPermissions,
      })
    })

    test('works when can edit channel permissions', async () => {
      asMockedFunction(getChannelInfo).mockResolvedValue([testChannel])
      asMockedFunction(getUserChannelEntryForUser)
        .mockResolvedValueOnce({
          ...user1TestChannelEntry,
          channelPermissions: { ...channelPermissions, editPermissions: true },
        })
        .mockResolvedValueOnce(user2TestChannelEntry)

      const result = await chatService.getUserPermissions(testChannel.id, user1.id, user2.id)

      expect(result).toEqual({
        userId: user2TestChannelEntry.userId,
        channelId: user2TestChannelEntry.channelId,
        permissions: user2TestChannelEntry.channelPermissions,
      })
    })
  })

  describe('updateUserPermissions', () => {
    const updateUserPermissionsMock = asMockedFunction(updateUserPermissions)

    test('should throw if not in channel', async () => {
      asMockedFunction(getUserChannelEntryForUser).mockResolvedValueOnce(null)

      await expect(
        chatService.updateUserPermissions(testChannel.id, user1.id, user2.id, channelPermissions),
      ).rejects.toThrowErrorMatchingInlineSnapshot(
        `"Must be in channel to update user's permissions"`,
      )
    })

    test('should throw if target user not in channel', async () => {
      asMockedFunction(getUserChannelEntryForUser)
        .mockResolvedValueOnce(user1TestChannelEntry)
        .mockResolvedValueOnce(null)

      await expect(
        chatService.updateUserPermissions(testChannel.id, user1.id, user2.id, channelPermissions),
      ).rejects.toThrowErrorMatchingInlineSnapshot(
        `"User must be in channel to update their permissions"`,
      )
    })

    test('should throw if not enough permissions', async () => {
      asMockedFunction(getUserChannelEntryForUser)
        .mockResolvedValueOnce(user1TestChannelEntry)
        .mockResolvedValueOnce(user2TestChannelEntry)

      await expect(
        chatService.updateUserPermissions(testChannel.id, user1.id, user2.id, channelPermissions),
      ).rejects.toThrowErrorMatchingInlineSnapshot(
        `"You don't have enough permissions to update other user's permissions"`,
      )
    })

    test('works when channel owner', async () => {
      await joinUserToChannel(
        user2,
        testChannel,
        user2TestChannelEntry,
        joinUser2TestChannelMessage,
      )

      asMockedFunction(getChannelInfo).mockResolvedValue([
        { ...testChannel, joinedChannelData: { topic: 'CHANNEL_TOPIC', ownerId: user1.id } },
      ])
      asMockedFunction(getUserChannelEntryForUser)
        .mockResolvedValueOnce(user1TestChannelEntry)
        .mockResolvedValueOnce(user2TestChannelEntry)

      await chatService.updateUserPermissions(
        testChannel.id,
        user1.id,
        user2.id,
        channelPermissions,
      )

      expect(updateUserPermissionsMock).toHaveBeenCalledWith(
        testChannel.id,
        user2.id,
        channelPermissions,
      )
      expect(client2.publish).toHaveBeenCalledWith(getChannelUserPath(testChannel.id, user2.id), {
        action: 'permissionsChanged',
        selfPermissions: channelPermissions,
      })
    })

    test('works when can edit channel permissions', async () => {
      await joinUserToChannel(
        user2,
        testChannel,
        user2TestChannelEntry,
        joinUser2TestChannelMessage,
      )

      asMockedFunction(getChannelInfo).mockResolvedValue([testChannel])
      asMockedFunction(getUserChannelEntryForUser)
        .mockResolvedValueOnce({
          ...user1TestChannelEntry,
          channelPermissions: { ...channelPermissions, editPermissions: true },
        })
        .mockResolvedValueOnce(user2TestChannelEntry)

      await chatService.updateUserPermissions(
        testChannel.id,
        user1.id,
        user2.id,
        channelPermissions,
      )

      expect(updateUserPermissionsMock).toHaveBeenCalledWith(
        testChannel.id,
        user2.id,
        channelPermissions,
      )
      expect(client2.publish).toHaveBeenCalledWith(getChannelUserPath(testChannel.id, user2.id), {
        action: 'permissionsChanged',
        selfPermissions: channelPermissions,
      })
    })
  })
})
