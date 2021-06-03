import errors from 'http-errors'
import { Map, OrderedSet, Set } from 'immutable'
import { isValidUsername } from '../../../common/constants'
import filterChatMessage from '../messaging/filter-chat-message'
import users from '../models/users'
import {
  addMessageToWhisper,
  closeWhisperSession,
  getMessagesForWhisperSession,
  getWhisperSessionsForUser,
  startWhisperSession,
} from '../models/whispers'
import createThrottle from '../throttle/create-throttle'
import throttleMiddleware from '../throttle/websocket-middleware'
import { Api, Mount, registerApiRoutes } from '../websockets/api-decorators'
import validateBody from '../websockets/validate-body'

const nonEmptyString = str => typeof str === 'string' && str.length > 0
const limit = val => typeof val === 'undefined' || (typeof val === 'number' && val > 0 && val < 100)
const beforeTime = val => typeof val === 'undefined' || (typeof val === 'number' && val >= -1)

const MOUNT_BASE = '/whispers'

function getPath(user, target) {
  const users = [user, target].sort()
  return `${MOUNT_BASE}/${encodeURIComponent(users[0] + '|' + users[1])}`
}

const startThrottle = createThrottle('whisperstart', {
  rate: 3,
  burst: 10,
  window: 60000,
})
const retrievalThrottle = createThrottle('whisperretrieval', {
  rate: 30,
  burst: 120,
  window: 60000,
})
const sendThrottle = createThrottle('whispersend', {
  rate: 30,
  burst: 90,
  window: 60000,
})

@Mount(MOUNT_BASE)
export class WhispersApi {
  constructor(nydus, userSockets) {
    this.nydus = nydus
    this.userSockets = userSockets
    // All the sessions a particular user has opened
    this.userSessions = new Map()
    // All the users that have a particular session opened
    this.sessionUsers = new Map()
    this.userSockets
      .on('newUser', user => this._handleNewUser(user))
      .on('userQuit', userId => this._handleUserQuit(userId))
  }

  @Api(
    '/start',
    validateBody({
      target: isValidUsername,
    }),
    'getUser',
    throttleMiddleware(startThrottle, data => data.get('user')),
    'noSelfMessaging',
    'getTarget',
  )
  async start(data, next) {
    const user = data.get('user')
    const target = data.get('target')
    await this._ensureWhisperSession(user, target)
  }

  @Api(
    '/send',
    validateBody({
      target: isValidUsername,
      message: nonEmptyString,
    }),
    'getUser',
    throttleMiddleware(sendThrottle, data => data.get('user')),
    'noSelfMessaging',
    'getTarget',
  )
  async send(data, next) {
    const { message } = data.get('body')
    const user = data.get('user')
    const target = data.get('target')

    const text = filterChatMessage(message)
    const result = await addMessageToWhisper(user.session.userId, target.name, {
      type: 'message',
      text,
    })

    // TODO(tec27): This makes the start throttle rather useless, doesn't it? Think of a better way
    // to throttle people starting tons of tons of sessions with different people
    await Promise.all([
      this._ensureWhisperSession(user, target),
      this._ensureWhisperSession(target, user),
    ])

    this._publishTo(user.name, target.name, {
      id: result.msgId,
      action: 'message',
      from: result.from,
      to: result.to,
      sent: +result.sent,
      data: result.data,
    })
  }

  @Api(
    '/getHistory',
    validateBody({
      target: isValidUsername,
      limit,
      beforeTime,
    }),
    'getUser',
    throttleMiddleware(retrievalThrottle, data => data.get('user')),
    'getTarget',
  )
  async getHistory(data, next) {
    const { limit, beforeTime } = data.get('body')
    const user = data.get('user')
    const target = data.get('target')

    if (!this.userSessions.get(user.name).has(target.name)) {
      throw new errors.Forbidden(
        'must have a whisper session with this user to retrieve message history',
      )
    }

    const messages = await getMessagesForWhisperSession(user.name, target.name, limit, beforeTime)
    return messages.map(m => ({
      id: m.msgId,
      from: m.from,
      to: m.to,
      sent: +m.sent,
      data: m.data,
    }))
  }

  @Api(
    '/close',
    validateBody({
      target: isValidUsername,
    }),
    'getUser',
    'getTarget',
  )
  async close(data, next) {
    const user = data.get('user')
    const target = data.get('target')
    if (!this.userSessions.get(user.name).has(target.name)) {
      throw new errors.NotFound('no whisper session with this user')
    }

    await closeWhisperSession(user.session.userId, target.name)
    this.userSessions = this.userSessions.update(user.name, s => s.delete(target.name))

    const updated = this.sessionUsers.get(target.name).delete(user.name)
    this.sessionUsers = updated.size
      ? this.sessionUsers.set(target.name, updated)
      : this.sessionUsers.delete(target.name)

    this._publishTo(user.name, target.name, {
      action: 'closeSession',
      target: target.name,
    })
    this._unsubscribeUserFromWhisperSession(user, target.name)
  }

  async getUser(data, next) {
    const user = this.userSockets.getBySocket(data.get('client'))
    if (!user) throw new errors.Unauthorized('authorization required')
    const newData = data.set('user', user)

    return next(newData)
  }

  async noSelfMessaging(data, next) {
    const user = data.get('user')
    const { target } = data.get('body')
    if (user.name.toLowerCase() === target.toLowerCase()) {
      throw new errors.BadRequest("can't whisper with yourself")
    }

    return next(data)
  }

  async getTarget(data, next) {
    const { target } = data.get('body')
    const foundUser = await users.find(target)
    if (!foundUser) {
      throw new errors.NotFound('target user not found')
    }

    const newData = data.set('target', foundUser)
    return next(newData)
  }

  _getUserStatus(user) {
    // TODO(2Pac): check if the user is idle as well
    const isUserOnline = this.userSockets.getById(user.userId)
    return isUserOnline ? 'active' : 'offline'
  }

  _publishTo(user, target, event) {
    this.nydus.publish(getPath(user, target), event)
  }

  _subscribeUserToWhisperSession(user, target) {
    user.subscribe(getPath(user.name, target.name), () => {
      return {
        action: 'initSession',
        target: target.name,
        targetStatus: this._getUserStatus(target),
      }
    })
  }

  _unsubscribeUserFromWhisperSession(user, target) {
    user.unsubscribe(getPath(user.name, target))
  }

  async _ensureWhisperSession(user, target) {
    await startWhisperSession(user.name, target.name)

    const userSockets = this.userSockets.getById(user.userId)
    // If the user is offline, the rest of the code will be done once they connect
    if (!userSockets) {
      return
    }

    // Maintain a list of users for each whisper session, so we can publish events to everyone that
    // has a session opened with a particular user
    this.sessionUsers = this.sessionUsers.update(target.name, new Set(), s => s.add(user.name))

    if (!this.userSessions.get(user.name).has(target.name)) {
      this.userSessions = this.userSessions.update(user.name, new OrderedSet(), s =>
        s.add(target.name),
      )
      this._subscribeUserToWhisperSession(userSockets, target)
    }
  }

  async _handleNewUser(user) {
    // Publish 'userActive' event to all users that have a session opened with the new user, if any
    if (this.sessionUsers.has(user.name)) {
      for (const u of this.sessionUsers.get(user.name).values()) {
        this._publishTo(user.name, u, { action: 'userActive', target: user.name })
      }
    }

    const whisperSessions = await getWhisperSessionsForUser(user.session.userId)
    if (!user.sockets.size) {
      // The user disconnected while we were waiting for their whisper sessions
      return
    }

    this.userSessions = this.userSessions.set(
      user.name,
      new OrderedSet(whisperSessions.map(s => s.targetUserName)),
    )
    for (const session of whisperSessions) {
      // Add the new user to all of the sessions they have opened
      this.sessionUsers = this.sessionUsers.update(session.targetUserName, new Set(), s =>
        s.add(user.name),
      )
      this._subscribeUserToWhisperSession(user, {
        userId: session.targetUserId,
        name: session.targetUserName,
      })
    }

    user.subscribe(`${user.getPath()}/whispers`, () => ({ type: 'whispersReady' }))
  }

  async _handleUserQuit(userId) {
    // TODO(2Pac): Remove this once internal whisper structures have been moved to use `userId`.
    const foundUser = await users.find(userId)
    if (!foundUser) {
      return
    }
    const { name: userName } = foundUser

    // Publish 'userOffline' event to all users that have a session opened with this user, if any
    if (this.sessionUsers.has(userName)) {
      for (const u of this.sessionUsers.get(userName).values()) {
        this._publishTo(userName, u, { action: 'userOffline', target: userName })
      }
    }

    if (!this.userSessions.has(userName)) {
      // This can happen if a user disconnects before we get their whisper sessions back from the DB
      return
    }

    // Delete the user that quit from all of the sessions they had opened, if any
    for (const target of this.userSessions.get(userName).values()) {
      const updated = this.sessionUsers.get(target).delete(userName)
      this.sessionUsers = updated.size
        ? this.sessionUsers.set(target, updated)
        : this.sessionUsers.delete(target)
    }
    this.userSessions = this.userSessions.delete(userName)
  }
}

export default function registerApi(nydus, userSockets) {
  const api = new WhispersApi(nydus, userSockets)
  registerApiRoutes(api, nydus)
  return api
}
