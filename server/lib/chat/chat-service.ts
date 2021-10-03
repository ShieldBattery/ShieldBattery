import { Map, Record, Set } from 'immutable'
import { singleton } from 'tsyringe'
import { assertUnreachable } from '../../../common/assert-unreachable'
import {
  ChatEvent,
  ChatInitEvent,
  ChatUser,
  GetChannelUsersServerPayload,
  ServerChatMessage,
  ServerChatMessageType,
} from '../../../common/chat'
import { SbUserId } from '../../../common/users/user-info'
import { DbClient } from '../db'
import filterChatMessage from '../messaging/filter-chat-message'
import { findUserById } from '../users/user-model'
import { UserSocketsGroup, UserSocketsManager } from '../websockets/socket-groups'
import { TypedPublisher } from '../websockets/typed-publisher'
import {
  addMessageToChannel,
  addUserToChannel,
  findChannel,
  getChannelsForUser,
  getMessagesForChannel,
  getUsersForChannel,
  leaveChannel,
} from './chat-models'

class ChatState extends Record({
  /**
   * Maps channel name -> Map of users in that channel. Map of users in the channel is mapped as
   * user ID -> object containing channel user data.
   */
  channels: Map<string, Map<number, ChatUser>>(),
  /** Maps userId -> Set of channels they're in (as names). */
  users: Map<number, Set<string>>(),
}) {}

export enum ChatServiceErrorCode {
  UserOffline,
  InvalidJoinAction,
  LeaveShieldBattery,
  InvalidLeaveAction,
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
    const originalChannelName = await this.getOriginalChannelName(channelName)
    if (this.state.users.has(userId) && this.state.users.get(userId)!.has(originalChannelName)) {
      throw new ChatServiceError(ChatServiceErrorCode.InvalidJoinAction, 'Already in this channel')
    }

    const result = await addUserToChannel(userId, originalChannelName, client)
    const message = await addMessageToChannel(userId, originalChannelName, {
      type: ServerChatMessageType.JoinChannel,
    })

    // NOTE(tec27): We don't/can't await this because it would be a recursive async dependency
    // (this function's Promise is await'd for the transaction, and transactionCompleted is awaited
    // by this function)
    transactionCompleted.then(() => {
      const channelUser = {
        id: result.userId,
        name: result.userName,
      }

      this.state = this.state
        .setIn(['channels', originalChannelName, result.userId], channelUser)
        // TODO(tec27): Remove `any` cast once Immutable properly types this call again
        .updateIn(['users', result.userId], (s = Set<string>()) =>
          (s as any).add(originalChannelName),
        )

      this.publisher.publish(getChannelPath(originalChannelName), {
        action: 'join',
        channelUser,
        user: {
          id: result.userId,
          name: result.userName,
        },
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
        this.subscribeUserToChannel(userSockets, originalChannelName)
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

    const { newOwner } = await leaveChannel(userSockets.userId, originalChannelName)
    const updated = this.state.channels.get(originalChannelName)!.delete(userSockets.userId)
    this.state = updated.size
      ? this.state.setIn(['channels', originalChannelName], updated)
      : this.state.deleteIn(['channels', originalChannelName])

    // TODO(tec27): Remove `any` cast once Immutable properly types this call again
    this.state = this.state.updateIn(['users', userSockets.userId], u =>
      (u as any).delete(originalChannelName),
    )

    this.publisher.publish(getChannelPath(originalChannelName), {
      action: 'leave',
      user: {
        id: userSockets.userId,
        name: userSockets.name,
      },
      newOwner,
    })
    this.unsubscribeUserFromChannel(userSockets, originalChannelName)
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
    const result = await addMessageToChannel(userSockets.userId, originalChannelName, {
      type: ServerChatMessageType.TextMessage,
      text,
    })

    this.publisher.publish(getChannelPath(originalChannelName), {
      action: 'message',
      id: result.msgId,
      type: result.data.type,
      channel: result.channelName,
      from: result.userId,
      user: {
        id: result.userId,
        name: result.userName,
      },
      time: Number(result.sent),
      text: result.data.text,
    })
  }

  async getChannelHistory(
    channelName: string,
    userId: SbUserId,
    limit?: number,
    beforeTime?: number,
  ): Promise<ServerChatMessage[]> {
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

    const messages = await getMessagesForChannel(
      originalChannelName,
      limit,
      beforeTime && beforeTime > -1 ? new Date(beforeTime) : undefined,
    )

    return messages.map(m => {
      switch (m.data.type) {
        case ServerChatMessageType.TextMessage:
          return {
            id: m.msgId,
            type: m.data.type,
            channel: m.channelName,
            from: m.userId,
            user: {
              id: m.userId,
              name: m.userName,
            },
            time: Number(m.sent),
            text: m.data.text,
          }
        case ServerChatMessageType.JoinChannel:
          return {
            id: m.msgId,
            type: m.data.type,
            channel: m.channelName,
            userId: m.userId,
            time: Number(m.sent),
          }
        default:
          return assertUnreachable(m.data)
      }
    })
  }

  async getChannelUsers(
    channelName: string,
    userId: SbUserId,
  ): Promise<GetChannelUsersServerPayload> {
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

    const users = await getUsersForChannel(originalChannelName)
    return {
      channelUsers: users.map(u => ({
        id: u.userId,
        name: u.userName,
      })),
      users: users.map(u => ({
        id: u.userId,
        name: u.userName,
      })),
    }
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

  private subscribeUserToChannel(userSockets: UserSocketsGroup, channelName: string) {
    userSockets.subscribe<ChatInitEvent>(getChannelPath(channelName), () => ({
      action: 'init',
      activeUsers: this.state.channels.get(channelName)!.valueSeq().toArray(),
    }))
  }

  unsubscribeUserFromChannel(user: UserSocketsGroup, channelName: string) {
    user.unsubscribe(getChannelPath(channelName))
  }

  private async handleNewUser(userSockets: UserSocketsGroup) {
    const channelsForUser = await getChannelsForUser(userSockets.userId)
    if (!userSockets.sockets.size) {
      // The user disconnected while we were waiting for their channel list
      return
    }

    const channelSet = Set(channelsForUser.map(c => c.channelName))
    const userMap = Map([[userSockets.userId, { id: userSockets.userId, name: userSockets.name }]])
    const inChannels = Map(channelsForUser.map(c => [c.channelName, userMap]))

    this.state = this.state
      .mergeDeepIn(['channels'], inChannels)
      .setIn(['users', userSockets.userId], channelSet)
    for (const { channelName: chan } of channelsForUser) {
      this.publisher.publish(getChannelPath(chan), {
        action: 'userActive',
        user: {
          id: userSockets.userId,
          name: userSockets.name,
        },
      })
      this.subscribeUserToChannel(userSockets, chan)
    }
    userSockets.subscribe(`${userSockets.getPath()}/chat`, () => ({ type: 'chatReady' }))
  }

  private async handleUserQuit(userId: SbUserId) {
    const user = await findUserById(userId)
    if (!user) {
      return
    }

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
        action: 'userOffline',
        user: {
          id: userId,
          name: user.name,
        },
      })
    }
  }
}
