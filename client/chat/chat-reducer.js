import { List, Map, OrderedSet, Record } from 'immutable'
import cuid from 'cuid'
import {
  CHAT_INIT_CHANNEL,
  CHAT_LOAD_CHANNEL_HISTORY_BEGIN,
  CHAT_LOAD_CHANNEL_HISTORY,
  CHAT_UPDATE_MESSAGE,
  CHAT_UPDATE_USER_ACTIVE,
  CHAT_UPDATE_USER_IDLE,
  CHAT_UPDATE_USER_OFFLINE,
} from '../actions'

export const Users = new Record({
  active: new List(),
  idle: new List(),
  offline: new List(),
})

export const Channel = new Record({
  name: null,
  messages: new List(),
  users: new Users(),

  hasLoadedHistory: false,
  loadingHistory: false,
  hasHistory: true,
})

export const ChatState = new Record({
  channels: new OrderedSet(),
  byName: new Map(),
})

// id, type, and time need to be present for ALL message types
export const ChatMessage = new Record({
  id: null,
  type: 'message',
  time: 0,
  from: null,
  text: null,
})
export const UserOnlineMessage = new Record({
  id: null,
  type: 'userOnline',
  time: 0,
  user: null,
})
export const UserOfflineMessage = new Record({
  id: null,
  type: 'userOffline',
  time: 0,
  user: null,
})

const handlers = {
  [CHAT_INIT_CHANNEL](state, action) {
    const { channel, activeUsers } = action.payload
    const record = new Channel({
      name: channel,
      users: new Users({
        active: new List(activeUsers),
      })
    })
    return (state.update('channels', c => c.add(channel))
      .setIn([ 'byName', channel ], record))
  },

  [CHAT_UPDATE_MESSAGE](state, action) {
    const { channel, time, user, message } = action.payload
    return state.updateIn([ 'byName', channel, 'messages' ], m => {
      return m.push(new ChatMessage({
        id: cuid(),
        time,
        from: user,
        text: message,
      }))
    })
  },

  [CHAT_UPDATE_USER_ACTIVE](state, action) {
    const { channel, user } = action.payload
    let wasIdle = false
    let updated = state.updateIn([ 'byName', channel, 'users' ], users => {
      const active = users.active.push(user)

      const idleIndex = users.idle.findIndex(u => u === user)
      wasIdle = idleIndex !== -1
      const idle = wasIdle ? users.idle.remove(idleIndex) : users.idle

      const offlineIndex = users.offline.findIndex(u => u === user)
      const offline = offlineIndex !== -1 ? users.offline.remove(offlineIndex) : users.offline

      return users.set('active', active).set('idle', idle).set('offline', offline)
    })

    if (!wasIdle) {
      updated = updated.updateIn([ 'byName', channel, 'messages' ], m => {
        return m.push(new UserOnlineMessage({
          id: cuid(),
          time: Date.now(),
          user,
        }))
      })
    }

    return updated
  },

  [CHAT_UPDATE_USER_IDLE](state, action) {
    const { channel, user } = action.payload
    return state.updateIn([ 'byName', channel, 'users' ], users => {
      const idle = users.idle.push(user)

      const activeIndex = users.active.findIndex(u => u === user)
      const active = activeIndex !== -1 ? users.active.remove(activeIndex) : users.active

      const offlineIndex = users.offline.findIndex(u => u === user)
      const offline = offlineIndex !== -1 ? users.offline.remove(offlineIndex) : users.offline

      return users.set('active', active).set('idle', idle).set('offline', offline)
    })
  },

  [CHAT_UPDATE_USER_OFFLINE](state, action) {
    const { channel, user } = action.payload
    return state.updateIn([ 'byName', channel, 'users' ], users => {
      const offline = users.offline.push(user)

      const activeIndex = users.active.findIndex(u => u === user)
      const active = activeIndex !== -1 ? users.active.remove(activeIndex) : users.active

      const idleIndex = users.idle.findIndex(u => u === user)
      const idle = idleIndex !== -1 ? users.idle.remove(idleIndex) : users.idle

      return users.set('active', active).set('idle', idle).set('offline', offline)
    }).updateIn([ 'byName', channel, 'messages' ], m => {
      return m.push(new UserOfflineMessage({
        id: cuid(),
        time: Date.now(),
        user,
      }))
    })
  },

  [CHAT_LOAD_CHANNEL_HISTORY_BEGIN](state, action) {
    const { channel } = action.payload
    return (state.setIn([ 'byName', channel, 'hasLoadedHistory' ], true)
      .setIn([ 'byName', channel, 'loadingHistory' ], true))
  },

  [CHAT_LOAD_CHANNEL_HISTORY](state, action) {
    const { channel } = action.meta
    const newMessages = action.payload
    const updated = state.setIn([ 'byName', channel, 'loadingHistory' ], false)
    if (!newMessages.length) {
      return updated.setIn([ 'byName', channel, 'hasHistory'], false)
    }

    // TODO(tec27): need to deal with all the different message types *somewhere* (here or in the
    // socket handler)
    return updated.updateIn([ 'byName', channel, 'messages'], messages => {
      return new List(newMessages.map(msg => new ChatMessage({
        id: msg.id,
        time: msg.sent,
        from: msg.user,
        text: msg.data.text,
      }))).concat(messages)
    })
  }
}

export default function(state = new ChatState(), action) {
  return handlers.hasOwnProperty(action.type) ? handlers[action.type](state, action) : state
}
