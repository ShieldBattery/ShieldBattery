import { Map, Record, Set } from 'immutable'
import errors from 'http-errors'
import { Mount, Api, registerApiRoutes } from '../websockets/api-decorators'
import validateBody from '../websockets/validate-body'
import {
  addMessageToChannel,
  getChannelsForUser,
  getMessagesForChannel,
} from '../models/chat-channels'

const ChatState = new Record({
  channels: new Map(),
  users: new Map(),
})

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

  @Api('/join')
  async join(data, next) {
    throw new errors.NotImplemented()
  }

  @Api('/leave')
  async leave(data, next) {
    throw new errors.NotImplemented()
  }

  @Api('/send',
    validateBody({
      channel: nonEmptyString,
      message: nonEmptyString,
    }),
    'getUser')
  async send(data, next) {
    const { channel, message } = data.get('body')
    const user = data.get('user')
    // TODO(tec27): lookup channel keys case insensitively?
    if (!this.state.users.has(user.name) || !this.state.users.get(user.name).has(channel)) {
      throw new errors.Forbidden('must be in a channel to send a message to it')
    }

    const text = message.length > 500 ? message.slice(0, 500) : message

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
      channel: nonEmptyString,
      beforeTime,
    }),
    'getUser')
  async getHistory(data, next) {
    const { channel, beforeTime } = data.get('body')
    const user = data.get('user')
    // TODO(tec27): lookup channel keys case insensitively?
    if (!this.state.users.has(user.name) || !this.state.users.get(user.name).has(channel)) {
      throw new errors.Forbidden('must be in a channel to retrieve message history')
    }

    const messages = await getMessagesForChannel(channel, 50, beforeTime)
    return messages.map(m => ({
      id: m.msgId,
      user: m.userName,
      sent: +m.sent,
      data: m.data,
    }))
  }

  async getUser(data, next) {
    const user = this.userSockets.getBySocket(data.get('client'))
    if (!user) throw new errors.Unauthorized('authorization required')
    const newData = data.set('user', user)

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
    this.nydus.publish(user.getUserPath(), { action: 'chatReady' })
  }

  async _handleUserQuit(userName) {
    if (!this.state.users.has(userName)) {
      // This can happen if a user disconects before we get their channel list back from the DB
      return
    }
    const channels = this.state.users.get(userName)
    this.state = this.state.update('channels', c => c.withMutations(c => {
      for (const chan of channels.values()) {
        // TODO(tec27): clean up empty Sets at some point? (Can't during withMutuations)
        c.set(chan, c.get(chan).delete(userName))
      }
    })).deleteIn('users', userName)

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
