import { Map, Record, Set } from 'immutable'
import { singleton } from 'tsyringe'
import { assertUnreachable } from '../../../common/assert-unreachable'
import {
  ChannelModerationAction,
  ChannelPermissions,
  ChatEvent,
  ChatInitEvent,
  GetChannelHistoryServerResponse,
  ServerChatMessage,
  ServerChatMessageType,
} from '../../../common/chat'
import { SbUser, SbUserId } from '../../../common/users/sb-user'
import { DbClient } from '../db'
import filterChatMessage from '../messaging/filter-chat-message'
import { processMessageContents } from '../messaging/process-chat-message'
import { getPermissions } from '../models/permissions'
import { findUserById, findUsersById } from '../users/user-model'
import { UserSocketsGroup, UserSocketsManager } from '../websockets/socket-groups'
import { TypedPublisher } from '../websockets/typed-publisher'
import {
  addMessageToChannel,
  addUserToChannel,
  banUserFromChannel,
  findChannel,
  getChannelsForUser,
  getMessagesForChannel,
  getUserChannelEntryForUser,
  getUsersForChannel,
  isUserBannedFromChannel,
  leaveChannel,
} from './chat-models'

class ChatState extends Record({
  /** Maps channel name -> Set of IDs of users in that channel. */
  channels: Map<string, Set<SbUserId>>(),
  /** Maps userId -> Set of channels they're in (as names). */
  users: Map<SbUserId, Set<string>>(),
}) {}

export enum ChatServiceErrorCode {
  UserOffline,
  UserNotFound,
  InvalidJoinAction,
  LeaveShieldBattery,
  InvalidLeaveAction,
  InvalidModerationAction,
  ModeratorAccess,
  UserBanned,
  InvalidSendAction,
  InvalidGetHistoryAction,
  InvalidGetUsersAction,
}

export class ChatServiceError extends Error {
  constructor(readonly code: ChatServiceErrorCode, message: string) {
    super(message)
  }
}

export function getChannelPath(channelName: string): string {
  return `/chat2/${encodeURIComponent(channelName)}`
}

@singleton()
export default class ChatService {
  private state = new ChatState()

  constructor(
    private publisher: TypedPublisher<ChatEvent>,
    private userSocketsManager: UserSocketsManager,
  ) {
    userSocketsManager
      .on('newUser', userSockets => this.handleNewUser(userSockets))
      .on('userQuit', userId => this.handleUserQuit(userId))
  }

  /**
   * Joins `channelName` with account `userId`, allowing them to receive and send messages in it.
   *
   * `client` can be specified to allow this action to happen with a DB transaction. If it is
   * specified, `transactionCompleted` should be a Promise that resolves when the transaction has
   * fully resolved.
   */
  async joinChannel(
    channelName: string,
    userId: SbUserId,
    client?: DbClient,
    transactionCompleted = Promise.resolve(),
  ): Promise<void> {
    // NOTE(tec27): VERY IMPORTANT. This method is used during user creation. You *cannot* assume
    // that any query involving the user will work unless it is done using the provided client (or
    // is done after `transactionCompleted` resolves). If you do not follow this rule, you *will*
    // break user creation and I *will* be sad :(

    const originalChannelName = await this.getOriginalChannelName(channelName)
    if (this.state.users.has(userId) && this.state.users.get(userId)!.has(originalChannelName)) {
      throw new ChatServiceError(ChatServiceErrorCode.InvalidJoinAction, 'Already in this channel')
    }

    const [userInfo, isBanned] = await Promise.all([
      findUserById(userId, client),
      isUserBannedFromChannel(originalChannelName, userId, client),
    ])
    if (!userInfo) {
      throw new ChatServiceError(ChatServiceErrorCode.UserNotFound, "User doesn't exist")
    }
    if (isBanned) {
      throw new ChatServiceError(
        ChatServiceErrorCode.UserBanned,
        'This user has been banned from this chat channel',
      )
    }

    const result = await addUserToChannel(userId, originalChannelName, client)
    const message = await addMessageToChannel(
      userId,
      originalChannelName,
      {
        type: ServerChatMessageType.JoinChannel,
      },
      client,
    )

    // NOTE(tec27): We don't/can't await this because it would be a recursive async dependency
    // (this function's Promise is await'd for the transaction, and transactionCompleted is awaited
    // by this function)
    transactionCompleted.then(() => {
      this.state = this.state
        // TODO(tec27): Remove `any` cast once Immutable properly types this call again
        .updateIn(['channels', originalChannelName], (s = Set<SbUserId>()) =>
          (s as any).add(result.userId),
        )
        // TODO(tec27): Remove `any` cast once Immutable properly types this call again
        .updateIn(['users', result.userId], (s = Set<string>()) =>
          (s as any).add(originalChannelName),
        )

      this.publisher.publish(getChannelPath(originalChannelName), {
        action: 'join2',
        user: userInfo,
        message: {
          id: message.msgId,
          type: ServerChatMessageType.JoinChannel,
          channel: message.channelName,
          userId: message.userId,
          time: Number(message.sent),
        },
      })

      // NOTE(tec27): We don't use the helper method here because joining channels while offline
      // is allowed in some cases (e.g. during account creation)
      const userSockets = this.userSocketsManager.getById(userId)
      if (userSockets) {
        this.subscribeUserToChannel(userSockets, result.channelName, result.channelPermissions)
      }
    })
  }

  async leaveChannel(channelName: string, userId: SbUserId): Promise<void> {
    const userSockets = this.getUserSockets(userId)
    const originalChannelName = await this.getOriginalChannelName(channelName)
    if (originalChannelName === 'ShieldBattery') {
      throw new ChatServiceError(
        ChatServiceErrorCode.LeaveShieldBattery,
        "Can't leave ShieldBattery channel",
      )
    }
    if (
      !this.state.users.has(userSockets.userId) ||
      !this.state.users.get(userSockets.userId)!.has(originalChannelName)
    ) {
      throw new ChatServiceError(
        ChatServiceErrorCode.InvalidLeaveAction,
        'Must be in channel to leave it',
      )
    }

    const newOwnerId = await this.removeUserFromChannel(originalChannelName, userId)

    this.publisher.publish(getChannelPath(originalChannelName), {
      action: 'leave2',
      userId: userSockets.userId,
      newOwnerId,
    })
    this.unsubscribeUserFromChannel(userSockets, originalChannelName)
  }

  async moderateUser(
    channelName: string,
    moderatorId: SbUserId,
    targetId: SbUserId,
    moderationAction: ChannelModerationAction,
    moderationReason?: string,
  ): Promise<void> {
    const [moderatorPermissions, moderatorUserChannel, targetUserChannel] = await Promise.all([
      getPermissions(moderatorId),
      getUserChannelEntryForUser(moderatorId, channelName),
      getUserChannelEntryForUser(targetId, channelName),
    ])

    if (!moderatorUserChannel) {
      throw new ChatServiceError(
        ChatServiceErrorCode.InvalidModerationAction,
        'Must be in channel to moderate users',
      )
    }
    if (!targetUserChannel) {
      throw new ChatServiceError(
        ChatServiceErrorCode.InvalidModerationAction,
        'User must be in channel to moderate them',
      )
    }
    if (moderatorId === targetId) {
      throw new ChatServiceError(
        ChatServiceErrorCode.InvalidModerationAction,
        "Can't moderate yourself",
      )
    }
    if (
      !moderatorPermissions?.moderateChatChannels &&
      !moderatorUserChannel.channelPermissions.owner
    ) {
      if (!moderatorUserChannel.channelPermissions[moderationAction]) {
        throw new ChatServiceError(
          ChatServiceErrorCode.ModeratorAccess,
          'Not enough permissions to moderate the user',
        )
      }
      if (
        targetUserChannel.channelPermissions.owner ||
        targetUserChannel.channelPermissions.editPermissions ||
        targetUserChannel.channelPermissions.ban ||
        targetUserChannel.channelPermissions.kick
      ) {
        throw new ChatServiceError(
          ChatServiceErrorCode.ModeratorAccess,
          "Can't moderate users that have moderator access",
        )
      }
    }

    const originalChannelName = await this.getOriginalChannelName(channelName)
    if (originalChannelName === 'ShieldBattery') {
      throw new ChatServiceError(
        ChatServiceErrorCode.LeaveShieldBattery,
        "Can't moderate users in the ShieldBattery channel",
      )
    }
    if (
      !this.state.users.has(targetId) ||
      !this.state.users.get(targetId)!.has(originalChannelName)
    ) {
      throw new ChatServiceError(
        ChatServiceErrorCode.InvalidModerationAction,
        'User must be in channel to moderate them',
      )
    }

    if (moderationAction === ChannelModerationAction.Ban) {
      await banUserFromChannel(originalChannelName, moderatorId, targetId, moderationReason)
    }

    // NOTE(2Pac): New owner can technically be selected if a global moderator removes the current
    // owner.
    const newOwnerId = await this.removeUserFromChannel(originalChannelName, targetId)

    // NOTE(2Pac): We don't use the helper method here because moderating people while they're
    // offline is allowed.
    const targetSockets = this.userSocketsManager.getById(targetId)
    if (targetSockets) {
      this.publisher.publish(getChannelPath(originalChannelName), {
        action: moderationAction,
        targetId: targetSockets.userId,
        newOwnerId,
      })
      this.unsubscribeUserFromChannel(targetSockets, originalChannelName)
    }
  }

  async sendChatMessage(channelName: string, userId: SbUserId, message: string): Promise<void> {
    const userSockets = this.getUserSockets(userId)
    const originalChannelName = await this.getOriginalChannelName(channelName)
    // TODO(tec27): lookup channel keys case insensitively?
    if (
      !this.state.users.has(userSockets.userId) ||
      !this.state.users.get(userSockets.userId)!.has(originalChannelName)
    ) {
      throw new ChatServiceError(
        ChatServiceErrorCode.InvalidSendAction,
        'Must be in a channel to send a message to it',
      )
    }

    const text = filterChatMessage(message)
    const [processedText, mentionedUsers] = await processMessageContents(text)
    const mentions = Array.from(mentionedUsers.values())
    const result = await addMessageToChannel(userSockets.userId, originalChannelName, {
      type: ServerChatMessageType.TextMessage,
      text: processedText,
      mentions: mentions.map(m => m.id),
    })

    this.publisher.publish(getChannelPath(originalChannelName), {
      action: 'message2',
      message: {
        id: result.msgId,
        type: result.data.type,
        channel: result.channelName,
        from: result.userId,
        time: Number(result.sent),
        text: result.data.text,
      },
      user: {
        id: result.userId,
        name: result.userName,
      },
      mentions,
    })
  }

  async getChannelHistory(
    channelName: string,
    userId: SbUserId,
    limit?: number,
    beforeTime?: number,
  ): Promise<GetChannelHistoryServerResponse> {
    const userSockets = this.getUserSockets(userId)
    const originalChannelName = await this.getOriginalChannelName(channelName)
    // TODO(tec27): lookup channel keys case insensitively?
    if (
      !this.state.users.has(userSockets.userId) ||
      !this.state.users.get(userSockets.userId)!.has(originalChannelName)
    ) {
      throw new ChatServiceError(
        ChatServiceErrorCode.InvalidGetHistoryAction,
        'Must be in a channel to retrieve message history',
      )
    }

    const dbMessages = await getMessagesForChannel(
      originalChannelName,
      limit,
      beforeTime && beforeTime > -1 ? new Date(beforeTime) : undefined,
    )

    const messages: ServerChatMessage[] = []
    const users: SbUser[] = []
    const mentionIds = new global.Set<SbUserId>()

    for (const msg of dbMessages) {
      switch (msg.data.type) {
        case ServerChatMessageType.TextMessage:
          messages.push({
            id: msg.msgId,
            type: msg.data.type,
            channel: msg.channelName,
            from: msg.userId,
            time: Number(msg.sent),
            text: msg.data.text,
          })
          users.push({ id: msg.userId, name: msg.userName })
          for (const mention of msg.data.mentions ?? []) {
            mentionIds.add(mention)
          }
          break

        case ServerChatMessageType.JoinChannel:
          messages.push({
            id: msg.msgId,
            type: msg.data.type,
            channel: msg.channelName,
            userId: msg.userId,
            time: Number(msg.sent),
          })
          users.push({ id: msg.userId, name: msg.userName })
          break

        default:
          return assertUnreachable(msg.data)
      }
    }

    const mentions = await findUsersById(Array.from(mentionIds))

    return {
      messages,
      users,
      mentions: Array.from(mentions.values()),
    }
  }

  async getChannelUsers(channelName: string, userId: SbUserId): Promise<SbUser[]> {
    const userSockets = this.getUserSockets(userId)
    const originalChannelName = await this.getOriginalChannelName(channelName)
    if (
      !this.state.users.has(userSockets.userId) ||
      !this.state.users.get(userSockets.userId)!.has(originalChannelName)
    ) {
      throw new ChatServiceError(
        ChatServiceErrorCode.InvalidGetUsersAction,
        'Must be in a channel to retrieve user list',
      )
    }

    return getUsersForChannel(originalChannelName)
  }

  async getOriginalChannelName(channelName: string): Promise<string> {
    const foundChannel = await findChannel(channelName)

    // If the channel already exists in database, return its name with original casing; otherwise
    // return it as is
    return foundChannel ? foundChannel.name : channelName
  }

  private getUserSockets(userId: SbUserId): UserSocketsGroup {
    const userSockets = this.userSocketsManager.getById(userId)
    if (!userSockets) {
      throw new ChatServiceError(ChatServiceErrorCode.UserOffline, 'User is offline')
    }

    return userSockets
  }

  private subscribeUserToChannel(
    userSockets: UserSocketsGroup,
    channelName: string,
    channelPermissions: ChannelPermissions,
  ) {
    userSockets.subscribe<ChatInitEvent>(getChannelPath(channelName), () => ({
      action: 'init2',
      activeUserIds: this.state.channels.get(channelName)!.toArray(),
      selfPermissions: channelPermissions,
    }))
  }

  unsubscribeUserFromChannel(user: UserSocketsGroup, channelName: string) {
    user.unsubscribe(getChannelPath(channelName))
  }

  private async removeUserFromChannel(
    channelName: string,
    userId: SbUserId,
  ): Promise<SbUserId | null> {
    const { newOwnerId } = await leaveChannel(userId, channelName)
    const updated = this.state.channels.get(channelName)!.delete(userId)
    this.state = updated.size
      ? this.state.setIn(['channels', channelName], updated)
      : this.state.deleteIn(['channels', channelName])

    // TODO(tec27): Remove `any` cast once Immutable properly types this call again
    this.state = this.state.updateIn(['users', userId], u => (u as any).delete(channelName))

    return newOwnerId
  }

  private async handleNewUser(userSockets: UserSocketsGroup) {
    const userChannels = await getChannelsForUser(userSockets.userId)
    if (!userSockets.sockets.size) {
      // The user disconnected while we were waiting for their channel list
      return
    }

    const channelSet = Set(userChannels.map(c => c.channelName))
    const userSet = Set<SbUserId>(userChannels.map(u => u.userId))
    const inChannels = Map(userChannels.map(c => [c.channelName, userSet]))

    this.state = this.state
      .mergeDeepIn(['channels'], inChannels)
      .setIn(['users', userSockets.userId], channelSet)
    for (const userChannel of userChannels) {
      this.publisher.publish(getChannelPath(userChannel.channelName), {
        action: 'userActive2',
        userId: userSockets.userId,
      })
      this.subscribeUserToChannel(
        userSockets,
        userChannel.channelName,
        userChannel.channelPermissions,
      )
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
