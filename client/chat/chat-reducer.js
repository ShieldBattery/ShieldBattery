import { List, Map, OrderedSet, Record, Set } from 'immutable'
import cuid from 'cuid'
import keyedReducer from '../reducers/keyed-reducer'
import * as SortedList from '../../shared/sorted-list'
import {
  CHAT_CHANNEL_ACTIVATE,
  CHAT_CHANNEL_DEACTIVATE,
  CHAT_INIT_CHANNEL,
  CHAT_LOAD_CHANNEL_HISTORY_BEGIN,
  CHAT_LOAD_CHANNEL_HISTORY,
  CHAT_LOAD_USER_LIST_BEGIN,
  CHAT_LOAD_USER_LIST,
  CHAT_UPDATE_MESSAGE,
  CHAT_UPDATE_USER_ACTIVE,
  CHAT_UPDATE_USER_IDLE,
  CHAT_UPDATE_USER_OFFLINE,
} from '../actions'
import {
  ChatMessage,
  UserOnlineMessage,
  UserOfflineMessage,
} from '../messaging/message-records'

// How many messages should be kept for inactive channels
const INACTIVE_CHANNEL_MAX_HISTORY = 150

const sortUsers = (a, b) => a.localeCompare(b)

// Create partial evaluations all the SortedList functions with our sort function pre-applied
const SortedUsers =
    Object.keys(SortedList)
      .map(fnName => [fnName, (...args) => SortedList[fnName](sortUsers, ...args)])
      .reduce((prev, cur) => {
        prev[cur[0]] = cur[1]
        return prev
      }, {})

export const Users = new Record({
  active: new List(),
  idle: new List(),
  offline: new List(),
})

const ChannelBase = new Record({
  name: null,
  messages: new List(),
  users: new Users(),

  loadingHistory: false,
  hasHistory: true,

  hasLoadedUserList: false,
  loadingUserList: false,

  activated: false,
  hasUnread: false,
})

export class Channel extends ChannelBase {
  get hasLoadedHistory() {
    return (this.loadingHistory ||
      this.messages.size > 0 ||
      (this.messages.size === 0 && !this.hasHistory)
    )
  }
}

export const ChatState = new Record({
  channels: new OrderedSet(),
  byName: new Map(),
})

function updateUserState(user, addTo, removeFirst, removeSecond) {
  const addToUpdated = SortedUsers.insert(addTo, user)

  const firstIndex = SortedUsers.findIndex(removeFirst, user)
  const removeFirstUpdated = firstIndex > -1 ? removeFirst.remove(firstIndex) : removeFirst

  const secondIndex = SortedUsers.findIndex(removeSecond, user)
  const removeSecondUpdated = secondIndex !== -1 ? removeSecond.remove(secondIndex) : removeSecond

  return [ addToUpdated, removeFirstUpdated, removeSecondUpdated ]
}

// Update the messages field for a channel, keeping the hasUnread flag in proper sync.
// updateFn is m => messages, and should perform the update operation on the messages field
function updateMessages(state, channelName, updateFn) {
  return state.updateIn(['byName', channelName], c => {
    let updated = updateFn(c.messages)
    if (updated === c.messages) {
      return c
    }

    let sliced = false
    if (!c.activated && updated.length > INACTIVE_CHANNEL_MAX_HISTORY) {
      updated = updated.slice(-INACTIVE_CHANNEL_MAX_HISTORY)
      sliced = true
    }

    return (c.set('messages', updated)
      .set('hasUnread', c.hasUnread || !c.activated)
      .set('hasHistory', c.hasHistory || sliced))
  })
}

export default keyedReducer(new ChatState(), {
  [CHAT_INIT_CHANNEL](state, action) {
    const { channel, activeUsers } = action.payload
    const sortedActiveUsers = SortedUsers.create(activeUsers)
    const record = new Channel({
      name: channel,
      users: new Users({
        active: sortedActiveUsers,
      })
    })
    return (state.update('channels', c => c.add(channel))
      .setIn(['byName', channel], record))
  },

  [CHAT_UPDATE_MESSAGE](state, action) {
    const { id, channel, time, user, message } = action.payload
    return updateMessages(state, channel, m => {
      return m.push(new ChatMessage({
        id,
        time,
        from: user,
        text: message,
      }))
    })
  },

  [CHAT_UPDATE_USER_ACTIVE](state, action) {
    const { channel, user } = action.payload
    let wasIdle = false
    let updated = state.updateIn(['byName', channel, 'users'], users => {
      const [ active, idle, offline ] =
          updateUserState(user, users.active, users.idle, users.offline)
      wasIdle = idle !== users.idle

      return users.set('active', active).set('idle', idle).set('offline', offline)
    })

    if (!updated.byName.get(channel).hasLoadedHistory) {
      // TODO(tec27): remove this check once #139 is fixed
      return updated
    }

    if (!wasIdle) {
      updated = updateMessages(updated, channel, m => {
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
    return state.updateIn(['byName', channel, 'users'], users => {
      const [ idle, active, offline ] =
          updateUserState(user, users.idle, users.active, users.offline)

      return users.set('active', active).set('idle', idle).set('offline', offline)
    })
  },

  [CHAT_UPDATE_USER_OFFLINE](state, action) {
    const { channel, user } = action.payload
    const updated = state.updateIn(['byName', channel, 'users'], users => {
      const [ offline, active, idle ] =
          updateUserState(user, users.offline, users.active, users.idle)

      return users.set('active', active).set('idle', idle).set('offline', offline)
    })

    if (!updated.byName.get(channel).hasLoadedHistory) {
      // TODO(tec27): remove this check once #139 is fixed
      return updated
    }

    return updateMessages(updated, channel, m => {
      return m.push(new UserOfflineMessage({
        id: cuid(),
        time: Date.now(),
        user,
      }))
    })
  },

  [CHAT_LOAD_CHANNEL_HISTORY_BEGIN](state, action) {
    const { channel } = action.payload
    return state.setIn(['byName', channel, 'loadingHistory'], true)
  },

  [CHAT_LOAD_CHANNEL_HISTORY](state, action) {
    const { channel } = action.meta
    const newMessages = action.payload
    const updated = state.setIn(['byName', channel, 'loadingHistory'], false)
    if (!newMessages.length) {
      return updated.setIn(['byName', channel, 'hasHistory'], false)
    }

    return updateMessages(updated, channel, messages => {
      return new List(newMessages.map(msg => new ChatMessage({
        id: msg.id,
        time: msg.sent,
        from: msg.user,
        text: msg.data.text,
      }))).concat(messages)
    })
  },

  [CHAT_LOAD_USER_LIST_BEGIN](state, action) {
    const { channel } = action.payload
    return (state.setIn(['byName', channel, 'hasLoadedUserList'], true)
      .setIn(['byName', channel, 'loadingUserList'], true))
  },

  [CHAT_LOAD_USER_LIST](state, action) {
    const { channel } = action.meta
    const userList = action.payload
    return (state.setIn(['byName', channel, 'loadingUserList'], false)
      .updateIn(['byName', channel, 'users'], users => {
        const offline =
            SortedUsers.create(new Set(userList).subtract(users.active).subtract(users.idle))
        return users.set('offline', offline)
      }))
  },

  [CHAT_CHANNEL_ACTIVATE](state, action) {
    const { channel } = action.payload
    return state.updateIn(['byName', channel], c => {
      return c.set('hasUnread', false).set('activated', true)
    })
  },

  [CHAT_CHANNEL_DEACTIVATE](state, action) {
    const { channel } = action.payload
    if (!state.byName.has(channel)) {
      return state
    }
    const hasHistory = state.byName.get(channel).messages.size > INACTIVE_CHANNEL_MAX_HISTORY

    return state.updateIn(['byName', channel], c => {
      return (c.set('messages', c.messages.slice(-INACTIVE_CHANNEL_MAX_HISTORY))
        .set('hasHistory', c.hasHistory || hasHistory)
        .set('activated', false))
    })
  },
})
