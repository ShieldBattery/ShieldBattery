import { NydusServer } from 'nydus'
import { singleton } from 'tsyringe'
import { Channel, ChannelInitEvent, ChannelJoinEvent, ChannelUser } from '../../../common/chat'
import { UserSocketsGroup, UserSocketsManager } from '../websockets/socket-groups'
import { addUserToChannel, findChannel, getJoinedChannels } from './chat-models'

export enum ChatServiceErrorCode {
  UserOffline,
  InvalidAction,
}

export class ChatServiceError extends Error {
  constructor(readonly code: ChatServiceErrorCode, message: string) {
    super(message)
  }
}

export function getChannelPath(channelName: string): string {
  return `/chat/${encodeURIComponent(channelName)}`
}

@singleton()
export default class ChatService {
  /** Map containing active users in each chat channel. */
  private channelActiveUsers = new Map<string, Set<ChannelUser>>()
  /** Map containing all joined chat channels for a particular user. */
  private userChannels = new Map<number, Set<string>>()

  constructor(private nydus: NydusServer, private userSocketsManager: UserSocketsManager) {
    userSocketsManager
      .on('newUser', (userSockets: UserSocketsGroup) => this.handleNewUser(userSockets))
      .on('userQuit', (userName: string) => this.handleUserQuit(userName))
  }

  async joinChannel(channelName: string, userId: number) {
    if (await this.isUserInChannel(userId, channelName)) {
      throw new ChatServiceError(ChatServiceErrorCode.InvalidAction, 'Already in this channel')
    }

    const { channel, user } = await addUserToChannel(userId, channelName)

    const channelUser: ChannelUser = {
      ...user,
      joinedAt: Number(user.joinDate),
    }

    const activeUsers = this.channelActiveUsers.get(channel.name) ?? new Set()
    this.channelActiveUsers.set(channel.name, activeUsers.add(channelUser))
    const joinedChannels = this.userChannels.get(user.id) ?? new Set()
    this.userChannels.set(user.id, joinedChannels.add(channel.name))

    const joinEventData: ChannelJoinEvent = {
      type: 'join',
      user: channelUser,
    }
    this.publishToChannel(channel.name, joinEventData)
    this.subscribeUserToChannel(user.name, channel)
  }

  private async isUserInChannel(userId: number, channelName: string) {
    const foundChannel = await findChannel(channelName)
    // If the channel already exists in database, save its name with original casing; otherwise save
    // it as is.
    const caseSensitiveChannelName = foundChannel ? foundChannel.name : channelName

    return (
      this.userChannels.has(userId) && this.userChannels.get(userId)!.has(caseSensitiveChannelName)
    )
  }

  private getUserSockets(userName: string): UserSocketsGroup {
    const userSockets = this.userSocketsManager.getByName(userName)
    if (!userSockets) {
      throw new ChatServiceError(ChatServiceErrorCode.UserOffline, 'User is offline')
    }

    return userSockets
  }

  private publishToChannel(channelName: string, data: any) {
    this.nydus.publish(getChannelPath(channelName), data)
  }

  private subscribeUserToChannel(userName: string, channel: Channel) {
    const userSockets = this.getUserSockets(userName)

    const initEventData: ChannelInitEvent = {
      type: 'init',
      channel,
      activeUsers: Array.from(this.channelActiveUsers.get(channel.name) ?? new Set()),
    }
    userSockets.subscribe(getChannelPath(channel.name), () => initEventData)
  }

  async handleNewUser(userSockets: UserSocketsGroup) {
    const userId = userSockets.session.userId
    const joinedChannels = await getJoinedChannels(userId)
    if (!userSockets.sockets.size) {
      // The user disconnected while we were waiting for their channel list
      return
    }

    for (const { channel, user } of joinedChannels) {
      const channelUser: ChannelUser = {
        ...user,
        joinedAt: Number(user.joinDate),
      }

      const activeUsers = this.channelActiveUsers.get(channel.name) ?? new Set()
      this.channelActiveUsers.set(channel.name, activeUsers.add(channelUser))
      const joinedChannels = this.userChannels.get(user.id) ?? new Set()
      this.userChannels.set(user.id, joinedChannels.add(channel.name))

      this.publishToChannel(channel.name, { action: 'userActive', user })
      this.subscribeUserToChannel(user.name, channel)
    }

    userSockets.subscribe(`${userSockets.getPath()}/chat`, () => ({ type: 'chatReady' }))
  }

  async handleUserQuit(userName) {
    // FIXME(2Pac): Handle this (need `userId` here)
  }
}
