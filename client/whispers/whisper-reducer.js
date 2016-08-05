import { List, Map, OrderedSet, Record } from 'immutable'
import cuid from 'cuid'
import keyedReducer from '../reducers/keyed-reducer'
import {
  WHISPERS_LOAD_SESSION_HISTORY_BEGIN,
  WHISPERS_LOAD_SESSION_HISTORY,
  WHISPERS_START_SESSION_BEGIN,
  WHISPERS_START_SESSION,
  WHISPERS_UPDATE_INIT_SESSION,
  WHISPERS_UPDATE_CLOSE_SESSION,
  WHISPERS_UPDATE_MESSAGE,
  WHISPERS_UPDATE_USER_ACTIVE,
  WHISPERS_UPDATE_USER_IDLE,
  WHISPERS_UPDATE_USER_OFFLINE,
  NETWORK_SITE_CONNECTED,
} from '../actions'
import {
  ChatMessage,
  UserOnlineMessage,
  UserOfflineMessage,
} from '../messaging/message-records'

const SessionBase = new Record({
  target: null,
  status: null,
  messages: new List(),

  loadingHistory: false,
  hasHistory: true,
})

export class Session extends SessionBase {
  get hasLoadedHistory() {
    return (this.loadingHistory ||
      this.messages.size > 0 ||
      (this.messages.size === 0 && !this.hasHistory)
    )
  }
}

export const WhisperState = new Record({
  sessions: new OrderedSet(),
  // Note that the keys for this map area always lower-case
  byName: new Map(),
  errorsByName: new Map(),
})

export default keyedReducer(new WhisperState(), {
  [WHISPERS_UPDATE_INIT_SESSION](state, action) {
    const { target, targetStatus: status } = action.payload
    const session = new Session({ target, status })

    return (state.update('sessions', s => s.add(target))
      .setIn(['byName', target.toLowerCase()], session))
  },

  [WHISPERS_START_SESSION_BEGIN](state, action) {
    const { target } = action.payload
    return state.deleteIn(['errorsByName', target.toLowerCase()])
  },

  [WHISPERS_START_SESSION](state, action) {
    if (action.error) {
      const { target } = action.meta
      const message = 'Something went wrong. Please try again and make sure you\'ve entered a' +
          ' correct username.'
      return state.setIn(['errorsByName', target.toLowerCase()], message)
    }

    return state
  },

  [WHISPERS_UPDATE_CLOSE_SESSION](state, action) {
    const { target } = action.payload

    return (state.update('sessions', s => s.delete(target))
      .deleteIn(['byName', target.toLowerCase()]))
  },

  [WHISPERS_UPDATE_MESSAGE](state, action) {
    const { id, time, from, to, message } = action.payload
    const target = state.sessions.has(from) ? from : to

    return state.updateIn(['byName', target.toLowerCase(), 'messages'], m => {
      return m.push(new ChatMessage({
        id,
        time,
        from,
        text: message,
      }))
    })
  },

  [WHISPERS_UPDATE_USER_ACTIVE](state, action) {
    const { user } = action.payload
    const name = user.toLowerCase()
    const wasIdle = state.byName.get(name).status === 'idle'
    if (wasIdle) {
      // Don't show online message if the user went from idle -> active
      return state
    }

    const updated = state.setIn(['byName', name, 'status'], 'active')

    if (!updated.byName.get(name).hasLoadedHistory) {
      // TODO(tec27): remove this check once #139 is fixed
      return updated
    }

    return updated.updateIn(['byName', name, 'messages'], m => {
      return m.push(new UserOnlineMessage({
        id: cuid(),
        time: Date.now(),
        user,
      }))
    })
  },

  [WHISPERS_UPDATE_USER_IDLE](state, action) {
    const { user } = action.payload

    return state.setIn(['byName', user.toLowerCase(), 'status'], 'idle')
  },

  [WHISPERS_UPDATE_USER_OFFLINE](state, action) {
    const { user } = action.payload
    const name = user.toLowerCase()

    const updated = state.setIn(['byName', name, 'status'], 'offline')

    if (!updated.byName.get(name).hasLoadedHistory) {
      // TODO(tec27): remove this check once #139 is fixed
      return updated
    }

    return updated.updateIn(['byName', name, 'messages'], m => {
      return m.push(new UserOfflineMessage({
        id: cuid(),
        time: Date.now(),
        user,
      }))
    })
  },

  [WHISPERS_LOAD_SESSION_HISTORY_BEGIN](state, action) {
    const { target } = action.payload

    return state.setIn(['byName', target.toLowerCase(), 'loadingHistory'], true)
  },

  [WHISPERS_LOAD_SESSION_HISTORY](state, action) {
    const { target } = action.meta
    const name = target.toLowerCase()
    const newMessages = action.payload
    const updated = state.setIn(['byName', name, 'loadingHistory'], false)
    if (!newMessages.length) {
      return updated.setIn(['byName', name, 'hasHistory'], false)
    }

    return updated.updateIn(['byName', name, 'messages'], messages => {
      return new List(newMessages.map(msg => new ChatMessage({
        id: msg.id,
        time: msg.sent,
        from: msg.from,
        text: msg.data.text,
      }))).concat(messages)
    })
  },

  [NETWORK_SITE_CONNECTED](state, action) {
    return new WhisperState()
  },
})
