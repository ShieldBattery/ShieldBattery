import errors from 'http-errors'
import { Map, Record, Set } from 'immutable'
import { NextFunc, NydusServer, RouteHandler } from 'nydus'
import { container, singleton } from 'tsyringe'
import { isValidChannelName } from '../../../common/constants'
import { MULTI_CHANNEL } from '../../../common/flags'
import filterChatMessage from '../messaging/filter-chat-message'
import {
  addMessageToChannel,
  addUserToChannel,
  findChannel,
  getChannelsForUser,
  getMessagesForChannel,
  getUsersForChannel,
  leaveChannel,
} from '../models/chat-channels'
import createThrottle from '../throttle/create-throttle'
import throttleMiddleware from '../throttle/websocket-middleware'
import { Api, Mount, registerApiRoutes } from '../websockets/api-decorators'
import { UserSocketsGroup, UserSocketsManager } from '../websockets/socket-groups'
import validateBody from '../websockets/validate-body'

class ChatState extends Record({
  /** Maps channel name -> Set of users in that channel (as names). */
  channels: Map<string, Set<string>>(),
  /** Maps username -> Set of channels they're in (as names). */
  users: Map<string, Set<string>>(),
}) {}

const joinThrottle = createThrottle('chatjoin', {
  rate: 3,
  burst: 10,
  window: 60000,
})
const retrievalThrottle = createThrottle('chatretrieval', {
  rate: 30,
  burst: 120,
  window: 60000,
})
const sendThrottle = createThrottle('chatsend', {
  rate: 30,
  burst: 90,
  window: 60000,
})

const featureEnabled: RouteHandler = async (data, next) => {
  if (!MULTI_CHANNEL) throw new errors.NotFound()
  return next(data)
}
const nonEmptyString = (str: unknown) => typeof str === 'string' && str.length > 0
const limit = (val: unknown) =>
  typeof val === 'undefined' || (typeof val === 'number' && val > 0 && val < 100)
const beforeTime = (val: unknown) =>
  typeof val === 'undefined' || (typeof val === 'number' && val >= -1)

const MOUNT_BASE = '/chat'

function getPath(channel: string) {
  return `${MOUNT_BASE}/${encodeURIComponent(channel)}`
}

@singleton()
@Mount(MOUNT_BASE)
export class ChatApi {
  private state = new ChatState()

  constructor(private nydus: NydusServer, private userSockets: UserSocketsManager) {
    this.userSockets
      .on('newUser', user => this.handleNewUser(user))
      .on('userQuit', name => this.handleUserQuit(name))
  }

  @Api(
    '/join',
    featureEnabled,
    validateBody({
      channel: isValidChannelName,
    }),
    'getUser',
    throttleMiddleware(joinThrottle, (data: Map<string, any>) => data.get('user')),
    'getChannel',
  )
  async join(data: Map<string, any>) {
    const user = data.get('user')
    const channel = data.get('channel')
    if (this.state.users.has(user.name) && this.state.users.get(user.name)!.has(channel)) {
      throw new errors.BadRequest('already in this channel')
    }

    await addUserToChannel(user.session.userId, channel)

    this.state = this.state
      .updateIn(['channels', channel], (s = Set()) => s.add(user.name))
      .updateIn(['users', user.name], (s = Set()) => s.add(channel))
    this._publishTo(channel, { action: 'join', user: user.name })
    this._subscribeUserToChannel(user, channel)
  }

  @Api(
    '/leave',
    featureEnabled,
    validateBody({
      channel: isValidChannelName,
    }),
    'getUser',
    'getChannel',
  )
  async leave(data: Map<string, any>) {
    const user = data.get('user')
    const channel = data.get('channel')
    if (channel === 'ShieldBattery') {
      throw new errors.Forbidden("can't leave ShieldBattery channel")
    }
    if (!this.state.users.has(user.name) || !this.state.users.get(user.name)!.has(channel)) {
      throw new errors.NotFound('not in this channel')
    }

    const result = await leaveChannel(user.session.userId, channel)
    const updated = this.state.channels.get(channel)!.delete(user.name)
    this.state = updated.size
      ? this.state.setIn(['channels', channel], updated)
      : this.state.deleteIn(['channels', channel])
    this.state = this.state.updateIn(['users', user.name], u => u.delete(channel))
    this._publishTo(channel, { action: 'leave', user: user.name, newOwner: result.newOwner })
    this._unsubscribeUserFromChannel(user, channel)
  }

  @Api(
    '/send',
    validateBody({
      channel: isValidChannelName,
      message: nonEmptyString,
    }),
    'getUser',
    throttleMiddleware(sendThrottle, (data: Map<string, any>) => data.get('user')),
    'getChannel',
  )
  async send(data: Map<string, any>) {
    const { message } = data.get('body')
    const user = data.get('user')
    const channel = data.get('channel')
    // TODO(tec27): lookup channel keys case insensitively?
    if (!this.state.users.has(user.name) || !this.state.users.get(user.name)!.has(channel)) {
      throw new errors.Forbidden('must be in a channel to send a message to it')
    }

    const text = filterChatMessage(message)
    const result = await addMessageToChannel(user.session.userId, channel, {
      type: 'message',
      text,
    })

    this._publishTo(channel, {
      id: result.msgId,
      action: 'message',
      user: result.userName,
      sent: +result.sent,
      data: result.data,
    })
  }

  @Api(
    '/getHistory',
    validateBody({
      channel: isValidChannelName,
      limit,
      beforeTime,
    }),
    'getUser',
    throttleMiddleware(retrievalThrottle, (data: Map<string, any>) => data.get('user')),
    'getChannel',
  )
  async getHistory(data: Map<string, any>) {
    const { limit, beforeTime } = data.get('body')
    const user = data.get('user')
    const channel = data.get('channel')
    // TODO(tec27): lookup channel keys case insensitively?
    if (!this.state.users.has(user.name) || !this.state.users.get(user.name)!.has(channel)) {
      throw new errors.Forbidden('must be in a channel to retrieve message history')
    }

    const messages = await getMessagesForChannel(
      channel,
      user.session.userId,
      limit,
      beforeTime && beforeTime > -1 ? new Date(beforeTime) : undefined,
    )
    return messages.map(m => ({
      id: m.msgId,
      user: m.userName,
      sent: +m.sent,
      data: m.data,
    }))
  }

  @Api(
    '/getUsers',
    validateBody({
      channel: isValidChannelName,
    }),
    'getUser',
    throttleMiddleware(retrievalThrottle, (data: Map<string, any>) => data.get('user')),
    'getChannel',
  )
  async getUsers(data: Map<string, any>) {
    const user = data.get('user')
    const channel = data.get('channel')
    if (!this.state.users.has(user.name) || !this.state.users.get(user.name)!.has(channel)) {
      throw new errors.Forbidden('must be in a channel to retrieve user list')
    }

    const users = await getUsersForChannel(channel)
    return users.map(u => u.userName)
  }

  async getUser(data: Map<string, any>, next: NextFunc) {
    const user = this.userSockets.getBySocket(data.get('client'))
    if (!user) throw new errors.Unauthorized('authorization required')
    const newData = data.set('user', user)

    return next(newData)
  }

  async getChannel(data: Map<string, any>, next: NextFunc) {
    const { channel } = data.get('body')
    const foundChannel = await findChannel(channel)

    // If the channel already exists in database, return its name with original casing; otherwise
    // return it as is
    const newData = data.set('channel', foundChannel ? foundChannel.name : channel)
    return next(newData)
  }

  // TODO(tec27): type event properly
  _publishTo(channel: string, event: any) {
    this.nydus.publish(getPath(channel), event)
  }

  _subscribeUserToChannel(user: UserSocketsGroup, channel: string) {
    user.subscribe(getPath(channel), () => {
      return {
        action: 'init',
        activeUsers: this.state.channels.get(channel),
      }
    })
  }

  _unsubscribeUserFromChannel(user: UserSocketsGroup, channel: string) {
    user.unsubscribe(getPath(channel))
  }

  private async handleNewUser(user: UserSocketsGroup) {
    const channelsForUser = await getChannelsForUser(user.session.userId)
    if (!user.sockets.size) {
      // The user disconnected while we were waiting for their channel list
      return
    }

    const channelSet = Set(channelsForUser.map(c => c.channelName))
    const userSet = Set([user.name])
    const inChannels = Map(channelsForUser.map(c => [c.channelName, userSet]))

    this.state = this.state
      .mergeDeepIn(['channels'], inChannels)
      .setIn(['users', user.name], channelSet)
    for (const { channelName: chan } of channelsForUser) {
      this._publishTo(chan, { action: 'userActive', user: user.name })
      this._subscribeUserToChannel(user, chan)
    }
    user.subscribe(`${user.getPath()}/chat`, () => ({ type: 'chatReady' }))
  }

  private async handleUserQuit(userName: string) {
    if (!this.state.users.has(userName)) {
      // This can happen if a user disconnects before we get their channel list back from the DB
      return
    }
    const channels = this.state.users.get(userName)!
    for (const channel of channels.values()) {
      const updated = this.state.channels.get(channel)?.delete(userName)
      this.state = updated?.size
        ? this.state.setIn(['channels', channel], updated)
        : this.state.deleteIn(['channels', channel])
    }
    this.state = this.state.deleteIn(['users', userName])

    for (const c of channels.values()) {
      this._publishTo(c, { action: 'userOffline', user: userName })
    }
  }
}

export default function registerApi(nydus: NydusServer) {
  const api = container.resolve(ChatApi)
  registerApiRoutes(api, nydus)
  return api
}
