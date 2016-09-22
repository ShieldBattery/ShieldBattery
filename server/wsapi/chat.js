import { Map, Record, Set } from 'immutable'
import errors from 'http-errors'
import { Mount, Api, registerApiRoutes } from '../websockets/api-decorators'
import validateBody from '../websockets/validate-body'
import filterChatMessage from '../messaging/filter-chat-message'
import { isValidChannelName } from '../../shared/constants'
import {
  addMessageToChannel,
  addUserToChannel,
  findChannel,
  getChannelsForUser,
  getMessagesForChannel,
  getUsersForChannel,
  leaveChannel,
} from '../models/chat-channels'
import { MULTI_CHANNEL } from '../../shared/flags'

const ChatState = new Record({
  channels: new Map(),
  users: new Map(),
})

const featureEnabled = async (data, next) => {
  if (!MULTI_CHANNEL) throw new errors.NotFound()
  return next(data)
}
const nonEmptyString = str => typeof str === 'string' && str.length > 0
const beforeTime = val => typeof val === 'undefined' || (typeof val === 'number' && val >= -1)

const MOUNT_BASE = '/chat'

function getPath(channel) {
  return `${MOUNT_BASE}/${encodeURIComponent(channel)}`
}

@Mount(MOUNT_BASE)
export class ChatApi {
  constructor(nydus, userSockets) {
    this.nydus = nydus
    this.userSockets = userSockets
    this.state = new ChatState()
    this.userSockets.on('newUser', user => this._handleNewUser(user))
      .on('userQuit', name => this._handleUserQuit(name))
  }

  @Api('/join',
    featureEnabled,
    validateBody({
      channel: isValidChannelName,
    }),
    'getUser',
    'getChannel')
  async join(data, next) {
    const user = data.get('user')
    const channel = data.get('channel')
    if (this.state.users.has(user.name) && this.state.users.get(user.name).has(channel)) {
      throw new errors.BadRequest('already in this channel')
    }

    await addUserToChannel(user.session.userId, channel)

    this.state = this.state.updateIn(['channels', channel], new Set(), s => s.add(user.name))
      .updateIn(['users', user.name], new Set(), s => s.add(channel))
    this._publishTo(channel, { action: 'join', user: user.name })
    this._subscribeUserToChannel(user, channel)
  }

  @Api('/leave',
    featureEnabled,
    validateBody({
      channel: isValidChannelName,
    }),
    'getUser',
    'getChannel')
  async leave(data, next) {
    const user = data.get('user')
    const channel = data.get('channel')
    if (channel === 'ShieldBattery') {
      throw new errors.Forbidden('can\'t leave ShieldBattery channel')
    }
    if (!this.state.users.has(user.name) || !this.state.users.get(user.name).has(channel)) {
      throw new errors.NotFound('not in this channel')
    }

    const result = await leaveChannel(user.session.userId, channel)
    const updated = this.state.channels.get(channel).delete(user.name)
    this.state = updated.size ? this.state.setIn(['channels', channel], updated) :
        this.state.deleteIn(['channels', channel])
    this.state = this.state.updateIn(['users', user.name], u => u.delete(channel))
    this._publishTo(channel, { action: 'leave', user: user.name, newOwner: result.newOwner })
    this._unsubscribeUserFromChannel(user, channel)
  }

  @Api('/send',
    validateBody({
      channel: isValidChannelName,
      message: nonEmptyString,
    }),
    'getUser',
    'getChannel')
  async send(data, next) {
    const { message } = data.get('body')
    const user = data.get('user')
    const channel = data.get('channel')
    // TODO(tec27): lookup channel keys case insensitively?
    if (!this.state.users.has(user.name) || !this.state.users.get(user.name).has(channel)) {
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
      data: result.data
    })
  }

  @Api('/getHistory',
    validateBody({
      channel: isValidChannelName,
      beforeTime,
    }),
    'getUser',
    'getChannel')
  async getHistory(data, next) {
    const { beforeTime } = data.get('body')
    const user = data.get('user')
    const channel = data.get('channel')
    // TODO(tec27): lookup channel keys case insensitively?
    if (!this.state.users.has(user.name) || !this.state.users.get(user.name).has(channel)) {
      throw new errors.Forbidden('must be in a channel to retrieve message history')
    }

    const messages = await getMessagesForChannel(channel, user.session.userId, 50, beforeTime)
    return messages.map(m => ({
      id: m.msgId,
      user: m.userName,
      sent: +m.sent,
      data: m.data,
    }))
  }

  @Api('/getUsers',
    validateBody({
      channel: isValidChannelName,
    }),
    'getUser',
    'getChannel')
  async getUsers(data, next) {
    const user = data.get('user')
    const channel = data.get('channel')
    if (!this.state.users.has(user.name) || !this.state.users.get(user.name).has(channel)) {
      throw new errors.Forbidden('must be in a channel to retrieve user list')
    }

    const users = await getUsersForChannel(channel)
    return users.map(u => u.userName)
  }

  async getUser(data, next) {
    const user = this.userSockets.getBySocket(data.get('client'))
    if (!user) throw new errors.Unauthorized('authorization required')
    const newData = data.set('user', user)

    return await next(newData)
  }

  async getChannel(data, next) {
    const { channel } = data.get('body')
    const foundChannel = await findChannel(channel)

    // If the channel already exists in database, return its name with original casing; otherwise
    // return it as is
    const newData = data.set('channel', foundChannel ? foundChannel.name : channel)
    return await next(newData)
  }

  _publishTo(channel, event) {
    this.nydus.publish(getPath(channel), event)
  }

  _subscribeUserToChannel(user, channel) {
    user.subscribe(getPath(channel), () => {
      return {
        action: 'init',
        activeUsers: this.state.channels.get(channel),
      }
    })
  }

  _unsubscribeUserFromChannel(user, channel) {
    user.unsubscribe(getPath(channel))
  }

  async _handleNewUser(user) {
    const channelsForUser = await getChannelsForUser(user.session.userId)
    if (!user.sockets.size) {
      // The user disconnected while we were waiting for their channel list
      return
    }

    const channelSet = new Set(channelsForUser.map(c => c.channelName))
    const userSet = new Set([ user.name ])
    const inChannels = new Map(channelsForUser.map(c => [ c.channelName, userSet ]))

    this.state = this.state.mergeDeepIn(['channels'], inChannels)
      .setIn(['users', user.name], channelSet)
    for (const { channelName: chan } of channelsForUser) {
      this._publishTo(chan, { action: 'userActive', user: user.name })
      this._subscribeUserToChannel(user, chan)
    }
    user.subscribe(`${user.getUserPath()}/chat`, () => ({ type: 'chatReady' }))
  }

  async _handleUserQuit(userName) {
    if (!this.state.users.has(userName)) {
      // This can happen if a user disconnects before we get their channel list back from the DB
      return
    }
    const channels = this.state.users.get(userName)
    for (const channel of channels.values()) {
      const updated = this.state.channels.get(channel).delete(userName)
      this.state = updated.size ? this.state.setIn(['channels', channel], updated) :
          this.state.deleteIn('channels', channel)
    }
    this.state = this.state.deleteIn('users', userName)

    for (const c of channels.values()) {
      this._publishTo(c, { action: 'userOffline', user: userName })
    }
  }
}

export default function registerApi(nydus, userSockets) {
  const api = new ChatApi(nydus, userSockets)
  registerApiRoutes(api, nydus)
  return api
}
