import { Map, Record as ImmutableRecord, Set } from 'immutable'
import { singleton } from 'tsyringe'
import { assertUnreachable } from '../../../common/assert-unreachable'
import {
  ChannelInfo,
  ChannelModerationAction,
  ChannelPermissions,
  ChannelStatus,
  ChatEvent,
  ChatInitEvent,
  ChatServiceErrorCode,
  ChatUserEvent,
  GetChannelHistoryServerResponse,
  SbChannelId,
  ServerChatMessage,
  ServerChatMessageType,
  toChatUserProfileJson,
} from '../../../common/chat'
import { SbUser, SbUserId } from '../../../common/users/sb-user'
import { DbClient } from '../db'
import { FOREIGN_KEY_VIOLATION, UNIQUE_VIOLATION } from '../db/pg-error-codes'
import { CodedError } from '../errors/coded-error'
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
  createChannel,
  findChannelByName,
  getChannelInfo,
  getChannelsForUser,
  getMessagesForChannel,
  getUserChannelEntryForUser,
  getUsersForChannel,
  isUserBannedFromChannel,
  removeUserFromChannel,
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

export function getChannelPath(channelId: SbChannelId): string {
  return `/chat3/${channelId}`
}

export function getChannelUserPath(channelId: SbChannelId, userId: SbUserId): string {
  return `/chat2/${channelId}/users/${userId}`
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
  ): Promise<ChannelInfo> {
    // NOTE(tec27): VERY IMPORTANT. This method is used during user creation. You *cannot* assume
    // that any query involving the user will work unless it is done using the provided client (or
    // is done after `transactionCompleted` resolves). If you do not follow this rule, you *will*
    // break user creation and I *will* be sad :(

    const userInfo = await findUserById(userId, client)
    if (!userInfo) {
      throw new ChatServiceError(ChatServiceErrorCode.UserNotFound, "User doesn't exist")
    }

    let succeeded = false
    let attempts = 0
    let channel: ChannelInfo | undefined
    let userChannelEntry: UserChannelEntry
    do {
      attempts += 1
      channel = await findChannelByName(channelName, client)
      if (channel) {
        if (this.state.users.has(userId) && this.state.users.get(userId)!.has(channel.id)) {
          throw new ChatServiceError(ChatServiceErrorCode.AlreadyJoined, 'Already in this channel')
        }

        const isBanned = await isUserBannedFromChannel(channel.id, userId, client)
        if (isBanned) {
          throw new ChatServiceError(
            ChatServiceErrorCode.UserBanned,
            'This user has been banned from this chat channel',
          )
        }

        try {
          userChannelEntry = await addUserToChannel(userId, channel.id, client)
          succeeded = true
        } catch (err: any) {
          if (err.code !== FOREIGN_KEY_VIOLATION) {
            throw err
          }
        }
      } else {
        try {
          channel = await createChannel(userId, channelName, client)
          userChannelEntry = await addUserToChannel(userId, channel.id, client)
          succeeded = true
        } catch (err: any) {
          if (err.code !== UNIQUE_VIOLATION) {
            throw err
          }
        }
      }
    } while (!succeeded && attempts < MAX_JOIN_ATTEMPTS)

    const message = await addMessageToChannel(
      userId,
      channel!.id,
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
        .updateIn(['channels', channel!.id], (s = Set<SbUserId>()) =>
          (s as any).add(userChannelEntry.userId),
        )
        // TODO(tec27): Remove `any` cast once Immutable properly types this call again
        .updateIn(['users', userChannelEntry.userId], (s = Set<string>()) =>
          (s as any).add(channel!.id),
        )

      this.publisher.publish(getChannelPath(channel!.id), {
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
      const userSockets = this.userSocketsManager.getById(userId)
      if (userSockets) {
        this.subscribeUserToChannel(
          userSockets,
          userChannelEntry.channelId,
          channel!,
          userChannelEntry.channelPermissions,
        )
      }
    })

    return channel!
  }

  async leaveChannel(channelId: SbChannelId, userId: SbUserId): Promise<void> {
    const userSockets = this.getUserSockets(userId)
    if (channelId === 1) {
      // TODO(2Pac): Remove this restriction once we have a news/home page
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
    const [[channelInfo], userPermissions, userChannelEntry, targetChannelEntry] =
      await Promise.all([
        getChannelInfo([channelId]),
        getPermissions(userId),
        getUserChannelEntryForUser(userId, channelId),
        getUserChannelEntryForUser(targetId, channelId),
      ])

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

    // TODO(2Pac): Really need tests for these.

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

    if (channelId === 1) {
      // TODO(2Pac): Remove this restriction once we have a news/home page
      throw new ChatServiceError(
        ChatServiceErrorCode.CannotModerateShieldBattery,
        "Can't moderate users in the ShieldBattery channel",
      )
    }

    if (moderationAction === ChannelModerationAction.Ban) {
      await banUserFromChannel(channelId, userId, targetId, moderationReason)
    }

    // NOTE(2Pac): New owner can technically be selected if a server moderator removes the current
    // owner.
    const newOwnerId = await this.removeUserFromChannel(channelId, targetId)

    this.publisher.publish(getChannelPath(channelId), {
      action: moderationAction,
      targetId,
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
    const [processedText, mentionedUsers] = await processMessageContents(text)
    const mentions = Array.from(mentionedUsers.values())
    const result = await addMessageToChannel(userSockets.userId, channelId, {
      type: ServerChatMessageType.TextMessage,
      text: processedText,
      mentions: mentions.map(m => m.id),
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
      mentions,
    })
  }

  async getChannelInfo(
    channelId: SbChannelId,
    channelName: string,
    userId: SbUserId,
  ): Promise<ChannelStatus> {
    const channelInfo: ChannelInfo | undefined = (await getChannelInfo([channelId]))[0]

    if (!channelInfo) {
      // If the channel with the same name exists, it means it was closed at some point (by everyone
      // in it leaving), and then created again by someone else, in which case it got a new ID.
      const channelClosed = await findChannelByName(channelName)
      if (channelClosed) {
        throw new ChatServiceError(ChatServiceErrorCode.ChannelClosed, 'Channel was closed')
      } else {
        throw new ChatServiceError(ChatServiceErrorCode.ChannelNotFound, 'Channel not found')
      }
    }

    let userCount
    if (!channelInfo.private) {
      const channelUsers = await getUsersForChannel(channelId)
      userCount = channelUsers.length
    }

    return {
      id: channelInfo.id,
      name: channelInfo.name,
      private: channelInfo.private,
      userCount,
    }
  }

  async getChannelHistory(
    channelId: SbChannelId,
    userId: SbUserId,
    limit?: number,
    beforeTime?: number,
  ): Promise<GetChannelHistoryServerResponse> {
    const userSockets = this.getUserSockets(userId)
    if (
      !this.state.users.has(userSockets.userId) ||
      !this.state.users.get(userSockets.userId)!.has(channelId)
    ) {
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
    const users: SbUser[] = []
    const mentionIds = new global.Set<SbUserId>()

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
          users.push({ id: msg.userId, name: msg.userName })
          for (const mention of msg.data.mentions ?? []) {
            mentionIds.add(mention)
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

  async getChannelUsers(channelId: SbChannelId, userId: SbUserId): Promise<SbUser[]> {
    const userSockets = this.getUserSockets(userId)
    if (
      !this.state.users.has(userSockets.userId) ||
      !this.state.users.get(userSockets.userId)!.has(channelId)
    ) {
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

    const channelInfo = (await getChannelInfo([chatUser.channelId]))[0]
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
    const [[channelInfo], userChannelEntry, targetChannelEntry] = await Promise.all([
      getChannelInfo([channelId]),
      getUserChannelEntryForUser(userId, channelId),
      getUserChannelEntryForUser(targetId, channelId),
    ])

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
    const [[channelInfo], userChannelEntry, targetChannelEntry] = await Promise.all([
      getChannelInfo([channelId]),
      getUserChannelEntryForUser(userId, channelId),
      getUserChannelEntryForUser(targetId, channelId),
    ])

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

  private subscribeUserToChannel(
    userSockets: UserSocketsGroup,
    channelId: SbChannelId,
    channelInfo: ChannelInfo,
    channelPermissions: ChannelPermissions,
  ) {
    userSockets.subscribe<ChatInitEvent>(getChannelPath(channelId), () => ({
      action: 'init3',
      channelInfo,
      activeUserIds: this.state.channels.get(channelId)!.toArray(),
      selfPermissions: channelPermissions,
    }))
    userSockets.subscribe(getChannelUserPath(channelId, userSockets.userId))
  }

  unsubscribeUserFromChannel(user: UserSocketsGroup, channelId: SbChannelId) {
    user.unsubscribe(getChannelPath(channelId))
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
    const channelInfos = await getChannelInfo(userChannels.map(uc => uc.channelId))
    const channelIdToInfo = Map<SbChannelId, ChannelInfo>(channelInfos.map(c => [c.id, c]))
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
      this.subscribeUserToChannel(
        userSockets,
        userChannel.channelId,
        channelIdToInfo.get(userChannel.channelId)!,
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
