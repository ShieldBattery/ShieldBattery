import { Map, Record as ImmutableRecord, Set } from 'immutable'
import { singleton } from 'tsyringe'
import { assertUnreachable } from '../../../common/assert-unreachable'
import {
  ChannelModerationAction,
  ChannelPermissions,
  ChatEvent,
  ChatInitEvent,
  ChatServiceErrorCode,
  ChatUserEvent,
  DetailedChannelInfo,
  GetBatchedChannelInfosResponse,
  GetChannelHistoryServerResponse,
  GetChannelInfoResponse,
  JoinChannelResponse,
  JoinedChannelInfo,
  makeSbChannelId,
  SbChannelId,
  SearchChannelsResponse,
  ServerChatMessage,
  ServerChatMessageType,
  toChatUserProfileJson,
} from '../../../common/chat'
import { subtract } from '../../../common/data-structures/sets'
import { CAN_LEAVE_SHIELDBATTERY_CHANNEL } from '../../../common/flags'
import { SbUser, SbUserId } from '../../../common/users/sb-user'
import { DbClient } from '../db'
import { FOREIGN_KEY_VIOLATION, UNIQUE_VIOLATION } from '../db/pg-error-codes'
import transact from '../db/transaction'
import { CodedError } from '../errors/coded-error'
import logger from '../logging/logger'
import filterChatMessage from '../messaging/filter-chat-message'
import { processMessageContents } from '../messaging/process-chat-message'
import { getPermissions } from '../models/permissions'
import { MIN_IDENTIFIER_MATCHES } from '../users/client-ids'
import { findConnectedUsers } from '../users/user-identifiers'
import { findUserById, findUsersById } from '../users/user-model'
import { UserSocketsGroup, UserSocketsManager } from '../websockets/socket-groups'
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
  FullChannelInfo,
  getChannelInfo,
  getChannelInfos,
  getChannelsForUser,
  getMessagesForChannel,
  getUserChannelEntriesForUser,
  getUserChannelEntryForUser,
  getUsersForChannel,
  isUserBannedFromChannel,
  removeUserFromChannel,
  searchChannels,
  toBasicChannelInfo,
  toDetailedChannelInfo,
  toJoinedChannelInfo,
  updateUserPermissions,
  UserChannelEntry,
} from './chat-models'

class ChatState extends ImmutableRecord({
  /** Maps channel id -> Set of IDs of users in that channel. */
  channels: Map<SbChannelId, Set<SbUserId>>(),
  /** Maps userId -> Set of channels they're in (as ids). */
  users: Map<SbUserId, Set<SbChannelId>>(),
}) {}

export class ChatServiceError extends CodedError<ChatServiceErrorCode> {}

class RetryableError extends Error {}

export function getChannelPath(channelId: SbChannelId): string {
  return `/chat3/${channelId}`
}

export function getChannelUserPath(channelId: SbChannelId, userId: SbUserId): string {
  return `${getChannelPath(channelId)}/users/${userId}`
}

/**
 * Maximum number of times that the service will attempt to (re)join the user in case of the timing
 * issues. E.g. in case the two users attempt to join the same non-existing channel at the same
 * time, they'll both attempt to create it, but only one will succeed.
 */
const MAX_JOIN_ATTEMPTS = 3

@singleton()
export default class ChatService {
  private state = new ChatState()

  constructor(
    private publisher: TypedPublisher<ChatEvent | ChatUserEvent>,
    private userSocketsManager: UserSocketsManager,
  ) {
    userSocketsManager
      .on('newUser', userSockets =>
        this.handleNewUser(userSockets).catch(err =>
          logger.error({ err }, 'Error handling new user in chat service'),
        ),
      )
      .on('userQuit', userId => this.handleUserQuit(userId))
  }

  private updateUserAfterJoining(
    userInfo: SbUser,
    channelId: SbChannelId,
    userChannelEntry: UserChannelEntry,
    message: ChatMessage,
  ) {
    this.state = this.state
      // TODO(tec27): Remove `any` cast once Immutable properly types this call again
      .updateIn(['channels', channelId], (s = Set<SbUserId>()) => (s as any).add(userInfo.id))
      // TODO(tec27): Remove `any` cast once Immutable properly types this call again
      .updateIn(['users', userInfo.id], (s = Set<string>()) => (s as any).add(channelId))

    this.publisher.publish(getChannelPath(channelId), {
      action: 'join2',
      user: userInfo,
      message: {
        id: message.msgId,
        type: ServerChatMessageType.JoinChannel,
        channelId: message.channelId,
        userId: message.userId,
        time: Number(message.sent),
      },
    })

    // NOTE(tec27): We don't use the helper method here because joining channels while offline
    // is allowed in some cases (e.g. during account creation)
    const userSockets = this.userSocketsManager.getById(userInfo.id)
    if (userSockets) {
      this.subscribeUserToChannel(userSockets, channelId)
    }
  }

  /**
   * Joins initial channel ("ShieldBattery") with account `userId`, allowing them to receive and
   * send messages in it. Assumes the "ShieldBattery" channel exists (and has ID 1), which it should
   * since it's created in the migration.
   *
   * `client` must be specified so this action happens inside a DB transaction of account creation.
   * Similarly, `transactionCompleted` should be a Promise that resolves when the transaction has
   * fully resolved.
   */
  async joinInitialChannel(
    userId: SbUserId,
    client: DbClient,
    transactionCompleted: Promise<void>,
  ): Promise<void> {
    // NOTE(tec27): VERY IMPORTANT. This method is used during user creation. You *cannot* assume
    // that any query involving the user will work unless it is done using the provided client (or
    // is done after `transactionCompleted` resolves). If you do not follow this rule, you *will*
    // break user creation and I *will* be sad :(

    const userInfo = await findUserById(userId, client)
    if (!userInfo) {
      throw new ChatServiceError(ChatServiceErrorCode.UserNotFound, "User doesn't exist")
    }

    const channelId = makeSbChannelId(1)
    const channelInfo = await getChannelInfo(channelId, client)
    if (!channelInfo) {
      throw new ChatServiceError(ChatServiceErrorCode.ChannelNotFound, 'Channel not found')
    }

    const userChannelEntry = await addUserToChannel(userId, channelId, client)
    const message = await addMessageToChannel(
      userId,
      channelId,
      {
        type: ServerChatMessageType.JoinChannel,
      },
      client,
    )

    // NOTE(tec27): We don't/can't await this because it would be a recursive async dependency
    // (this function's Promise is await'd for the transaction, and transactionCompleted is awaited
    // by this function)
    transactionCompleted.then(() =>
      this.updateUserAfterJoining(userInfo, channelInfo.id, userChannelEntry, message),
    )
  }

  private async banUserFromChannelIfNeeded(
    channelId: SbChannelId,
    targetId: SbUserId,
    client: DbClient,
  ): Promise<boolean> {
    const count = await countBannedIdentifiersForChannel({ channelId, targetId }, client)
    if (count >= MIN_IDENTIFIER_MATCHES) {
      const connectedUsers = await findConnectedUsers(
        targetId,
        MIN_IDENTIFIER_MATCHES,
        false,
        client,
      )
      await banUserFromChannel({ channelId, targetId, automated: true, connectedUsers }, client)
      await banAllIdentifiersFromChannel({ channelId, targetId }, client)
      return true
    }

    return false
  }

  /**
   * Joins `channelName` with account `userId`, allowing them to receive and send messages in it.
   * Handles the use case of two users attempting to join a channel at the same time.
   */
  async joinChannel(channelName: string, userId: SbUserId): Promise<JoinChannelResponse> {
    const userInfo = await findUserById(userId)
    if (!userInfo) {
      throw new ChatServiceError(ChatServiceErrorCode.UserNotFound, "User doesn't exist")
    }

    let succeeded = false
    let isUserInChannel = false
    let isUserBanned = false
    let attempts = 0
    let channel: FullChannelInfo | undefined
    let userChannelEntry: UserChannelEntry | undefined
    let message: ChatMessage
    do {
      attempts += 1
      try {
        await transact(async client => {
          channel = await findChannelByName(channelName, client)
          if (channel) {
            isUserInChannel = Boolean(await getUserChannelEntryForUser(userId, channel.id))
            if (isUserInChannel) {
              succeeded = true
              return
            }

            const isBanned = await isUserBannedFromChannel(channel.id, userId, client)
            if (isBanned || (await this.banUserFromChannelIfNeeded(channel.id, userId, client))) {
              isUserBanned = true
              return
            }

            try {
              userChannelEntry = await addUserToChannel(userId, channel.id, client)
              message = await addMessageToChannel(
                userId,
                channel.id,
                {
                  type: ServerChatMessageType.JoinChannel,
                },
                client,
              )
              succeeded = true
            } catch (err: any) {
              if (err.code === FOREIGN_KEY_VIOLATION) {
                throw new RetryableError()
              } else {
                throw err
              }
            }
          } else {
            try {
              channel = await createChannel(userId, channelName, client)
              userChannelEntry = await addUserToChannel(userId, channel.id, client)
              message = await addMessageToChannel(
                userId,
                channel.id,
                {
                  type: ServerChatMessageType.JoinChannel,
                },
                client,
              )
              succeeded = true
            } catch (err: any) {
              if (err.code === UNIQUE_VIOLATION) {
                throw new RetryableError()
              } else {
                throw err
              }
            }
          }
        })
      } catch (err) {
        if (!(err instanceof RetryableError)) {
          throw err
        }
      }
    } while (!succeeded && !isUserBanned && attempts < MAX_JOIN_ATTEMPTS)

    if (isUserBanned) {
      throw new ChatServiceError(ChatServiceErrorCode.UserBanned, 'User is banned')
    }

    // NOTE(2Pac): This is just to silence the TS compiler since it can't figure out on its own that
    // `channel` will be defined here.
    channel = channel!

    if (!isUserInChannel) {
      this.updateUserAfterJoining(userInfo, channel.id, userChannelEntry!, message!)
    }

    return {
      channelInfo: toBasicChannelInfo(channel),
      detailedChannelInfo: toDetailedChannelInfo(channel),
      joinedChannelInfo: toJoinedChannelInfo(channel),
    }
  }

  async leaveChannel(channelId: SbChannelId, userId: SbUserId): Promise<void> {
    const userSockets = this.getUserSockets(userId)
    if (channelId === 1 && !CAN_LEAVE_SHIELDBATTERY_CHANNEL) {
      throw new ChatServiceError(
        ChatServiceErrorCode.CannotLeaveShieldBattery,
        "Can't leave ShieldBattery channel",
      )
    }
    if (
      !this.state.users.has(userSockets.userId) ||
      !this.state.users.get(userSockets.userId)!.has(channelId)
    ) {
      throw new ChatServiceError(
        ChatServiceErrorCode.NotInChannel,
        'Must be in channel to leave it',
      )
    }

    const newOwnerId = await this.removeUserFromChannel(channelId, userId)

    this.publisher.publish(getChannelPath(channelId), {
      action: 'leave2',
      userId: userSockets.userId,
      newOwnerId,
    })
    this.unsubscribeUserFromChannel(userSockets, channelId)
  }

  async moderateUser(
    channelId: SbChannelId,
    userId: SbUserId,
    targetId: SbUserId,
    moderationAction: ChannelModerationAction,
    moderationReason?: string,
  ): Promise<void> {
    const [channelInfo, userPermissions, userChannelEntry, targetChannelEntry] = await Promise.all([
      getChannelInfo(channelId),
      getPermissions(userId),
      getUserChannelEntryForUser(userId, channelId),
      getUserChannelEntryForUser(targetId, channelId),
    ])

    if (!channelInfo) {
      throw new ChatServiceError(ChatServiceErrorCode.ChannelNotFound, 'Channel not found')
    }
    if (!userChannelEntry) {
      throw new ChatServiceError(
        ChatServiceErrorCode.NotInChannel,
        'Must be in channel to moderate users',
      )
    }
    if (!targetChannelEntry) {
      throw new ChatServiceError(
        ChatServiceErrorCode.TargetNotInChannel,
        'User must be in channel to moderate them',
      )
    }
    if (userId === targetId) {
      throw new ChatServiceError(
        ChatServiceErrorCode.CannotModerateYourself,
        "Can't moderate yourself",
      )
    }
    if (channelId === 1 && !CAN_LEAVE_SHIELDBATTERY_CHANNEL) {
      throw new ChatServiceError(
        ChatServiceErrorCode.CannotModerateShieldBattery,
        "Can't moderate users in the ShieldBattery channel",
      )
    }

    const isUserServerModerator =
      userPermissions?.editPermissions || userPermissions?.moderateChatChannels

    const isUserChannelOwner = channelInfo.ownerId === userId
    const isTargetChannelOwner = channelInfo.ownerId === targetId

    const isUserChannelModerator =
      userChannelEntry.channelPermissions.editPermissions ||
      userChannelEntry.channelPermissions[moderationAction]
    const isTargetChannelModerator =
      targetChannelEntry.channelPermissions.editPermissions ||
      targetChannelEntry.channelPermissions.ban ||
      targetChannelEntry.channelPermissions.kick

    if (isTargetChannelOwner && !isUserServerModerator) {
      throw new ChatServiceError(
        ChatServiceErrorCode.CannotModerateChannelOwner,
        'Only server moderators can moderate channel owners',
      )
    }
    if (isTargetChannelModerator && !isUserServerModerator && !isUserChannelOwner) {
      throw new ChatServiceError(
        ChatServiceErrorCode.CannotModerateChannelModerator,
        'Only server moderators and channel owners can moderate channel moderators',
      )
    }
    if (!isUserServerModerator && !isUserChannelOwner && !isUserChannelModerator) {
      throw new ChatServiceError(
        ChatServiceErrorCode.NotEnoughPermissions,
        'Not enough permissions to moderate the user',
      )
    }

    if (moderationAction === ChannelModerationAction.Ban) {
      await transact(async client => {
        await banUserFromChannel(
          { channelId, moderatorId: userId, targetId, reason: moderationReason },
          client,
        )
        await banAllIdentifiersFromChannel({ channelId, targetId }, client)
      })
    }

    // NOTE(2Pac): New owner can technically be selected if a server moderator removes the current
    // owner.
    const newOwnerId = await this.removeUserFromChannel(channelId, targetId)

    this.publisher.publish(getChannelPath(channelId), {
      action: moderationAction,
      targetId,
      channelName: channelInfo.name,
      newOwnerId,
    })

    // NOTE(2Pac): We don't use the helper method here because moderating people while they're
    // offline is allowed.
    const targetSockets = this.userSocketsManager.getById(targetId)
    if (targetSockets) {
      this.unsubscribeUserFromChannel(targetSockets, channelId)
    }
  }

  async sendChatMessage(channelId: SbChannelId, userId: SbUserId, message: string): Promise<void> {
    const userSockets = this.getUserSockets(userId)
    if (
      !this.state.users.has(userSockets.userId) ||
      !this.state.users.get(userSockets.userId)!.has(channelId)
    ) {
      throw new ChatServiceError(
        ChatServiceErrorCode.NotInChannel,
        'Must be in a channel to send a message to it',
      )
    }

    const text = filterChatMessage(message)
    const [processedText, userMentions, channelMentions] = await processMessageContents(text)
    const mentionedUserIds = userMentions.map(u => u.id)
    const mentionedChannelIds = channelMentions.map(c => c.id)
    const result = await addMessageToChannel(userSockets.userId, channelId, {
      type: ServerChatMessageType.TextMessage,
      text: processedText,
      mentions: mentionedUserIds.length > 0 ? mentionedUserIds : undefined,
      channelMentions: mentionedChannelIds.length > 0 ? mentionedChannelIds : undefined,
    })

    this.publisher.publish(getChannelPath(channelId), {
      action: 'message2',
      message: {
        id: result.msgId,
        type: result.data.type,
        channelId: result.channelId,
        from: result.userId,
        time: Number(result.sent),
        text: result.data.text,
      },
      user: {
        id: result.userId,
        name: result.userName,
      },
      mentions: userMentions,
      channelMentions: channelMentions.map(c => toBasicChannelInfo(c)),
    })
  }

  async deleteMessage({
    channelId,
    messageId,
    userId,
    isAdmin,
  }: {
    channelId: SbChannelId
    messageId: string
    userId: SbUserId
    isAdmin: boolean
  }): Promise<void> {
    // TODO(2Pac): Update this method to allow channel moderators to delete messages from the
    // channels they moderate, and for users to delete their own message.

    if (!isAdmin) {
      throw new ChatServiceError(
        ChatServiceErrorCode.NotEnoughPermissions,
        'Not enough permissions to delete a message',
      )
    }

    await deleteChannelMessage(messageId, channelId)

    this.publisher.publish(getChannelPath(channelId), {
      action: 'messageDeleted',
      messageId,
    })
  }

  async getChannelInfo(channelId: SbChannelId, userId: SbUserId): Promise<GetChannelInfoResponse> {
    const [channelInfo, userChannelEntry] = await Promise.all([
      getChannelInfo(channelId),
      getUserChannelEntryForUser(userId, channelId),
    ])
    const isUserInChannel = Boolean(userChannelEntry)

    if (!channelInfo) {
      throw new ChatServiceError(ChatServiceErrorCode.ChannelNotFound, 'Channel not found')
    }

    return {
      channelInfo: toBasicChannelInfo(channelInfo),
      detailedChannelInfo:
        !channelInfo.private || isUserInChannel ? toDetailedChannelInfo(channelInfo) : undefined,
      joinedChannelInfo:
        !channelInfo.private || isUserInChannel ? toJoinedChannelInfo(channelInfo) : undefined,
    }
  }

  async getChannelInfos(
    channelIds: SbChannelId[],
    userId: SbUserId,
  ): Promise<GetBatchedChannelInfosResponse> {
    const [channelInfos, userChannelEntries] = await Promise.all([
      getChannelInfos(channelIds),
      getUserChannelEntriesForUser(userId, channelIds),
    ])

    const userJoinedChannelsSet = new global.Set(userChannelEntries.map(e => e.channelId))
    const detailedChannelInfos: DetailedChannelInfo[] = []
    const joinedChannelInfos: JoinedChannelInfo[] = []

    for (const channel of channelInfos) {
      if (channel.private && !userJoinedChannelsSet.has(channel.id)) {
        continue
      }

      detailedChannelInfos.push(toDetailedChannelInfo(channel))
      joinedChannelInfos.push(toJoinedChannelInfo(channel))
    }

    return {
      channelInfos: channelInfos.map(channel => toBasicChannelInfo(channel)),
      detailedChannelInfos,
      joinedChannelInfos,
    }
  }

  async searchChannels({
    userId,
    limit,
    offset,
    searchStr,
  }: {
    userId: SbUserId
    limit: number
    offset: number
    searchStr?: string
  }): Promise<SearchChannelsResponse> {
    const [channels, joinedChannels] = await Promise.all([
      searchChannels({ limit, offset, searchStr }),
      getChannelsForUser(userId),
    ])

    const userJoinedChannelsSet = new global.Set(joinedChannels.map(c => c.channelId))
    const detailedChannelInfos: DetailedChannelInfo[] = []
    const joinedChannelInfos: JoinedChannelInfo[] = []

    for (const channel of channels) {
      if (channel.private && !userJoinedChannelsSet.has(channel.id)) {
        continue
      }

      detailedChannelInfos.push(toDetailedChannelInfo(channel))
      joinedChannelInfos.push(toJoinedChannelInfo(channel))
    }

    return {
      channelInfos: channels.map(channel => toBasicChannelInfo(channel)),
      detailedChannelInfos,
      joinedChannelInfos,
      hasMoreChannels: channels.length >= limit,
    }
  }

  async getChannelHistory({
    channelId,
    userId,
    limit,
    beforeTime,
    isAdmin,
  }: {
    channelId: SbChannelId
    userId: SbUserId
    limit?: number
    beforeTime?: number
    isAdmin?: boolean
  }): Promise<GetChannelHistoryServerResponse> {
    const isUserInChannel = Boolean(await getUserChannelEntryForUser(userId, channelId))
    if (!isAdmin && !isUserInChannel) {
      throw new ChatServiceError(
        ChatServiceErrorCode.NotInChannel,
        'Must be in a channel to retrieve message history',
      )
    }

    const dbMessages = await getMessagesForChannel(
      channelId,
      limit,
      beforeTime && beforeTime > -1 ? new Date(beforeTime) : undefined,
    )

    const messages: ServerChatMessage[] = []
    const userIds = new global.Set<SbUserId>()
    const userMentionIds = new global.Set<SbUserId>()
    const channelMentionIds = new global.Set<SbChannelId>()

    for (const msg of dbMessages) {
      switch (msg.data.type) {
        case ServerChatMessageType.TextMessage:
          messages.push({
            id: msg.msgId,
            type: msg.data.type,
            channelId: msg.channelId,
            from: msg.userId,
            time: Number(msg.sent),
            text: msg.data.text,
          })
          userIds.add(msg.userId)
          for (const mentionId of msg.data.mentions ?? []) {
            userMentionIds.add(mentionId)
          }
          for (const mentionId of msg.data.channelMentions ?? []) {
            channelMentionIds.add(mentionId)
          }
          break

        case ServerChatMessageType.JoinChannel:
          messages.push({
            id: msg.msgId,
            type: msg.data.type,
            channelId: msg.channelId,
            userId: msg.userId,
            time: Number(msg.sent),
          })
          userIds.add(msg.userId)
          break

        default:
          return assertUnreachable(msg.data)
      }
    }

    const [users, userMentions, channelMentions] = await Promise.all([
      findUsersById(Array.from(userIds)),
      findUsersById(Array.from(userMentionIds)),
      getChannelInfos(Array.from(channelMentionIds)),
    ])

    const deletedChannels =
      channelMentionIds.size === channelMentions.length
        ? []
        : Array.from(
            subtract(
              channelMentionIds,
              channelMentions.map(c => c.id),
            ),
          )

    return {
      messages,
      users,
      mentions: userMentions,
      channelMentions: channelMentions.map(c => toBasicChannelInfo(c)),
      deletedChannels,
    }
  }

  async getChannelUsers({
    channelId,
    userId,
    isAdmin,
  }: {
    channelId: SbChannelId
    userId: SbUserId
    isAdmin?: boolean
  }): Promise<SbUser[]> {
    const isUserInChannel = Boolean(await getUserChannelEntryForUser(userId, channelId))
    if (!isAdmin && !isUserInChannel) {
      throw new ChatServiceError(
        ChatServiceErrorCode.NotInChannel,
        'Must be in a channel to retrieve user list',
      )
    }

    return getUsersForChannel(channelId)
  }

  async getChatUserProfile(channelId: SbChannelId, userId: SbUserId, targetId: SbUserId) {
    const userSockets = this.getUserSockets(userId)
    if (
      !this.state.users.has(userSockets.userId) ||
      !this.state.users.get(userSockets.userId)!.has(channelId)
    ) {
      throw new ChatServiceError(
        ChatServiceErrorCode.NotInChannel,
        'Must be in a channel to retrieve user profile',
      )
    }

    const chatUser = await getUserChannelEntryForUser(targetId, channelId)
    // This usually means the user has left the channel.
    if (!chatUser) {
      // We don't throw an error here because users can still request the profile of users that have
      // left the channel. So we return a response without a profile and expect clients to handle
      // those users in any way they want.
      return {
        userId: targetId,
        channelId,
      }
    }

    const channelInfo = await getChannelInfo(chatUser.channelId)
    // NOTE(2Pac): This would be a very odd error indeed. It would mean we still have an entry for
    // this user being in this channel, but channel itself does not exist anymore.
    if (!channelInfo) {
      throw new ChatServiceError(ChatServiceErrorCode.ChannelNotFound, 'Channel not found')
    }

    const isOwner = channelInfo.ownerId === userId

    const { channelPermissions: perms } = chatUser
    return {
      userId: chatUser.userId,
      channelId: chatUser.channelId,
      profile: toChatUserProfileJson({
        userId: chatUser.userId,
        channelId: chatUser.channelId,
        joinDate: chatUser.joinDate,
        isModerator: isOwner || perms.editPermissions || perms.ban || perms.kick,
      }),
    }
  }

  async getUserPermissions(channelId: SbChannelId, userId: SbUserId, targetId: SbUserId) {
    const [channelInfo, userChannelEntry, targetChannelEntry] = await Promise.all([
      getChannelInfo(channelId),
      getUserChannelEntryForUser(userId, channelId),
      getUserChannelEntryForUser(targetId, channelId),
    ])

    if (!channelInfo) {
      throw new ChatServiceError(ChatServiceErrorCode.ChannelNotFound, 'Channel not found')
    }
    if (!userChannelEntry) {
      throw new ChatServiceError(
        ChatServiceErrorCode.NotInChannel,
        "Must be in channel to get user's permissions",
      )
    }
    if (!targetChannelEntry) {
      throw new ChatServiceError(
        ChatServiceErrorCode.TargetNotInChannel,
        'User must be in channel to get their permissions',
      )
    }

    const isUserChannelOwner = channelInfo.ownerId === userId
    if (!isUserChannelOwner && !userChannelEntry.channelPermissions.editPermissions) {
      throw new ChatServiceError(
        ChatServiceErrorCode.NotEnoughPermissions,
        "You don't have enough permissions to get other user's permissions",
      )
    }

    return {
      userId: targetChannelEntry.userId,
      channelId: targetChannelEntry.channelId,
      permissions: targetChannelEntry.channelPermissions,
    }
  }

  async updateUserPermissions(
    channelId: SbChannelId,
    userId: SbUserId,
    targetId: SbUserId,
    permissions: ChannelPermissions,
  ) {
    const [channelInfo, userChannelEntry, targetChannelEntry] = await Promise.all([
      getChannelInfo(channelId),
      getUserChannelEntryForUser(userId, channelId),
      getUserChannelEntryForUser(targetId, channelId),
    ])

    if (!channelInfo) {
      throw new ChatServiceError(ChatServiceErrorCode.ChannelNotFound, 'Channel not found')
    }
    if (!userChannelEntry) {
      throw new ChatServiceError(
        ChatServiceErrorCode.NotInChannel,
        "Must be in channel to update user's permissions",
      )
    }
    if (!targetChannelEntry) {
      throw new ChatServiceError(
        ChatServiceErrorCode.TargetNotInChannel,
        'User must be in channel to update their permissions',
      )
    }

    const isUserChannelOwner = channelInfo.ownerId === userId
    if (!isUserChannelOwner && !userChannelEntry.channelPermissions.editPermissions) {
      throw new ChatServiceError(
        ChatServiceErrorCode.NotEnoughPermissions,
        "You don't have enough permissions to update other user's permissions",
      )
    }

    await updateUserPermissions(channelId, targetId, permissions)
    this.publisher.publish(getChannelUserPath(channelId, targetId), {
      action: 'permissionsChanged',
      selfPermissions: permissions,
    })
  }

  private getUserSockets(userId: SbUserId): UserSocketsGroup {
    const userSockets = this.userSocketsManager.getById(userId)
    if (!userSockets) {
      throw new ChatServiceError(ChatServiceErrorCode.UserOffline, 'User is offline')
    }

    return userSockets
  }

  private subscribeUserToChannel(userSockets: UserSocketsGroup, channelId: SbChannelId) {
    userSockets.subscribe<ChatInitEvent>(getChannelPath(channelId), async () => {
      try {
        const [channelInfo, userChannelEntry] = await Promise.all([
          getChannelInfo(channelId),
          getUserChannelEntryForUser(userSockets.userId, channelId),
        ])
        if (!channelInfo) {
          return undefined
        }
        if (!userChannelEntry) {
          return undefined
        }

        return {
          action: 'init3',
          channelInfo: toBasicChannelInfo(channelInfo),
          detailedChannelInfo: toDetailedChannelInfo(channelInfo),
          joinedChannelInfo: toJoinedChannelInfo(channelInfo),
          activeUserIds: this.state.channels.get(channelInfo.id)!.toArray(),
          selfPermissions: userChannelEntry.channelPermissions,
        }
      } catch (err) {
        logger.error({ err }, 'Error retrieving the initial channel data for the user')
        return undefined
      }
    })
    userSockets.subscribe(getChannelUserPath(channelId, userSockets.userId))
  }

  unsubscribeUserFromChannel(user: UserSocketsGroup, channelId: SbChannelId) {
    user.unsubscribe(getChannelPath(channelId))
    user.unsubscribe(getChannelUserPath(channelId, user.userId))
  }

  private async removeUserFromChannel(
    channelId: SbChannelId,
    userId: SbUserId,
  ): Promise<SbUserId | undefined> {
    const { newOwnerId } = await removeUserFromChannel(userId, channelId)

    const updated = this.state.channels.get(channelId)!.delete(userId)
    this.state = updated.size
      ? this.state.setIn(['channels', channelId], updated)
      : this.state.deleteIn(['channels', channelId])

    if (this.state.users.has(userId) && this.state.users.get(userId)!.has(channelId)) {
      // TODO(tec27): Remove `any` cast once Immutable properly types this call again
      this.state = this.state.updateIn(['users', userId], u => (u as any).delete(channelId))
    }

    return newOwnerId
  }

  private async handleNewUser(userSockets: UserSocketsGroup) {
    const userChannels = await getChannelsForUser(userSockets.userId)
    if (!userSockets.sockets.size) {
      // The user disconnected while we were waiting for their channel list
      return
    }

    const channelSet = Set(userChannels.map(c => c.channelId))
    const userSet = Set<SbUserId>(userChannels.map(u => u.userId))
    const inChannels = Map(userChannels.map(c => [c.channelId, userSet]))

    this.state = this.state
      .mergeDeepIn(['channels'], inChannels)
      .setIn(['users', userSockets.userId], channelSet)
    for (const userChannel of userChannels) {
      this.publisher.publish(getChannelPath(userChannel.channelId), {
        action: 'userActive2',
        userId: userSockets.userId,
      })
      this.subscribeUserToChannel(userSockets, userChannel.channelId)
    }
    userSockets.subscribe(`${userSockets.getPath()}/chat`, () => ({ type: 'chatReady' }))
  }

  private handleUserQuit(userId: SbUserId) {
    if (!this.state.users.has(userId)) {
      // This can happen if a user disconnects before we get their channel list back from the DB
      return
    }
    const channels = this.state.users.get(userId)!
    for (const channel of channels.values()) {
      const updated = this.state.channels.get(channel)?.delete(userId)
      this.state = updated?.size
        ? this.state.setIn(['channels', channel], updated)
        : this.state.deleteIn(['channels', channel])
    }
    this.state = this.state.deleteIn(['users', userId])

    for (const c of channels.values()) {
      this.publisher.publish(getChannelPath(c), {
        action: 'userOffline2',
        userId,
      })
    }
  }
}
