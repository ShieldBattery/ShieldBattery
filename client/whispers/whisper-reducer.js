import { List, Map, OrderedSet, Record } from 'immutable'
import cuid from 'cuid'
import {
  WHISPERS_LOAD_SESSION_HISTORY_BEGIN,
  WHISPERS_LOAD_SESSION_HISTORY,
  WHISPERS_SESSION_ACTIVATE,
  WHISPERS_SESSION_DEACTIVATE,
  WHISPERS_START_SESSION_BEGIN,
  WHISPERS_START_SESSION,
  WHISPERS_UPDATE_INIT_SESSION,
  WHISPERS_UPDATE_CLOSE_SESSION,
  WHISPERS_UPDATE_MESSAGE,
  WHISPERS_UPDATE_USER_ACTIVE,
  WHISPERS_UPDATE_USER_IDLE,
  WHISPERS_UPDATE_USER_OFFLINE,
} from '../actions'
import {
  ChatMessage,
  UserOnlineMessage,
  UserOfflineMessage,
} from '../messaging/message-records'

// How many messages should be kept for inactive whisper sessions
const INACTIVE_WHISPER_SESSION_MAX_HISTORY = 150

const SessionBase = new Record({
  target: null,
  status: null,
  messages: new List(),

  loadingHistory: false,
  hasHistory: true,

  activated: false,
  hasUnread: false,
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
  byName: new Map(),
  errorsByName: new Map(),
})

// Update the messages field for a whisper session, keeping the hasUnread flag in proper sync.
// updateFn is m => messages, and should perform the update operation on the messages field
function updateMessages(state, target, updateFn) {
  return state.updateIn(['byName', target], t => {
    let updated = updateFn(t.messages)
    if (updated === t.messages) {
      return t
    }

    let sliced = false
    if (!t.activated && updated.length > INACTIVE_WHISPER_SESSION_MAX_HISTORY) {
      updated = updated.slice(-INACTIVE_WHISPER_SESSION_MAX_HISTORY)
      sliced = true
    }

    return (t.set('messages', updated)
      .set('hasUnread', t.hasUnread || !t.activated)
      .set('hasHistory', t.hasHistory || sliced))
  })
}

const handlers = {
  [WHISPERS_UPDATE_INIT_SESSION](state, action) {
    const { target, targetStatus: status } = action.payload
    const session = new Session({ target, status })

    return (state.update('sessions', s => s.add(target))
      .setIn(['byName', target], session))
  },

  [WHISPERS_START_SESSION_BEGIN](state, action) {
    const { target } = action.payload
    return state.deleteIn(['errorsByName', target])
  },

  [WHISPERS_START_SESSION](state, action) {
    if (action.error) {
      const { target } = action.meta
      const message = 'Something went wrong. Please try again and make sure you\'ve entered a' +
          ' correct username.'
      return state.setIn(['errorsByName', target], message)
    }

    return state
  },

  [WHISPERS_UPDATE_CLOSE_SESSION](state, action) {
    const { target } = action.payload

    return (state.update('sessions', s => s.delete(target))
      .deleteIn(['byName', target]))
  },

  [WHISPERS_UPDATE_MESSAGE](state, action) {
    const { id, time, from, to, message } = action.payload
    const target = state.sessions.has(from) ? from : to

    return updateMessages(state, target, m => {
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
    const wasIdle = state.byName.get(user).status === 'idle'
    if (wasIdle) {
      // Don't show online message if the user went from idle -> active
      return state
    }

    const updated = state.setIn(['byName', user, 'status'], 'active')

    if (!updated.byName.get(user).hasLoadedHistory) {
      // TODO(tec27): remove this check once #139 is fixed
      return updated
    }

    return updateMessages(updated, user, m => {
      return m.push(new UserOnlineMessage({
        id: cuid(),
        time: Date.now(),
        user,
      }))
    })
  },

  [WHISPERS_UPDATE_USER_IDLE](state, action) {
    const { user } = action.payload

    return state.setIn(['byName', user, 'status'], 'idle')
  },

  [WHISPERS_UPDATE_USER_OFFLINE](state, action) {
    const { user } = action.payload

    const updated = state.setIn(['byName', user, 'status'], 'offline')

    if (!updated.byName.get(user).hasLoadedHistory) {
      // TODO(tec27): remove this check once #139 is fixed
      return updated
    }

    return updateMessages(updated, user, m => {
      return m.push(new UserOfflineMessage({
        id: cuid(),
        time: Date.now(),
        user,
      }))
    })
  },

  [WHISPERS_LOAD_SESSION_HISTORY_BEGIN](state, action) {
    const { target } = action.payload

    return state.setIn(['byName', target, 'loadingHistory'], true)
  },

  [WHISPERS_LOAD_SESSION_HISTORY](state, action) {
    const { target } = action.meta
    const newMessages = action.payload
    const updated = state.setIn(['byName', target, 'loadingHistory'], false)
    if (!newMessages.length) {
      return updated.setIn(['byName', target, 'hasHistory'], false)
    }

    return updateMessages(updated, target, messages => {
      return new List(newMessages.map(msg => new ChatMessage({
        id: msg.id,
        time: msg.sent,
        from: msg.from,
        text: msg.data.text,
      }))).concat(messages)
    })
  },

  [WHISPERS_SESSION_ACTIVATE](state, action) {
    const { target } = action.payload
    return state.updateIn(['byName', target], t => {
      return t.set('hasUnread', false).set('activated', true)
    })
  },

  [WHISPERS_SESSION_DEACTIVATE](state, action) {
    const { target } = action.payload
    const hasHistory = state.byName.get(target).messages.size > INACTIVE_WHISPER_SESSION_MAX_HISTORY

    return state.updateIn(['byName', target], t => {
      return (t.set('messages', t.messages.slice(-INACTIVE_WHISPER_SESSION_MAX_HISTORY))
        .set('hasHistory', t.hasHistory || hasHistory)
        .set('activated', false))
    })
  },
}

export default function whispersReducer(state = new WhisperState(), action) {
  return handlers.hasOwnProperty(action.type) ? handlers[action.type](state, action) : state
}
