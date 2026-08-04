import { Immutable } from 'immer'
import { SbUserId } from '../../common/users/sb-user-id'
import { CommonMessageType, CommonTextMessage } from '../messaging/message-records'
import { immerKeyedReducer } from '../reducers/keyed-reducer'

// How many messages should be kept for inactive channels
const INACTIVE_SESSION_MAX_HISTORY = 150

export interface WhisperSession {
  target: SbUserId
  messages: CommonTextMessage[]

  hasHistory: boolean

  activated: boolean
  /** Whether this session's message list is scrolled to the bottom. */
  atBottom: boolean
  hasUnread: boolean
}

function defaultWhisperSession(target: SbUserId): WhisperSession {
  return {
    target,
    messages: [],
    hasHistory: true,
    activated: false,
    atBottom: false,
    hasUnread: false,
  }
}

export interface WhisperState {
  sessions: Set<SbUserId>
  byId: Map<SbUserId, WhisperSession>
}

const DEFAULT_STATE: Immutable<WhisperState> = {
  sessions: new Set(),
  byId: new Map(),
}

/**
 * Update the messages field for a whisper, keeping the `hasUnread` flag in proper sync.
 */
function updateMessages(
  state: WhisperState,
  target: SbUserId,
  makeUnread: boolean,
  updateFn: (messages: CommonTextMessage[]) => CommonTextMessage[],
) {
  const session = state.byId.get(target)
  if (!session) {
    return
  }

  session.messages = updateFn(session.messages)

  // Trimming is safe when nobody is reading scrollback: either the session isn't being viewed, or
  // the viewer is pinned to the bottom, where auto-scroll makes removing top messages invisible.
  const canTrim = !session.activated || session.atBottom

  let sliced = false
  if (canTrim && session.messages.length > INACTIVE_SESSION_MAX_HISTORY) {
    session.messages = session.messages.slice(-INACTIVE_SESSION_MAX_HISTORY)
    sliced = true
  }

  if (makeUnread && !session.hasUnread && !session.activated) {
    session.hasUnread = true
  }

  session.hasHistory = session.hasHistory || sliced
}

export default immerKeyedReducer(DEFAULT_STATE, {
  ['@whispers/getWhisperSessions'](state, action) {
    state.sessions = new Set(action.payload.sessions)

    for (const session of action.payload.sessions) {
      if (state.byId.has(session)) {
        continue
      }

      state.byId.set(session, defaultWhisperSession(session))
    }
  },

  ['@whispers/initSession'](state, action) {
    const { target } = action.payload
    state.byId.set(target, defaultWhisperSession(target))
    state.sessions = new Set([target, ...state.sessions])
  },

  ['@whispers/closeSession'](state, action) {
    const { target } = action.payload

    state.sessions.delete(target)
    state.byId.delete(target)
  },

  ['@whispers/updateMessage'](
    state,
    {
      payload: {
        message: { id, time, from, text },
      },
      meta: { target },
    },
  ) {
    const newMessage: CommonTextMessage = {
      id,
      type: CommonMessageType.TextMessage,
      time,
      from,
      text,
    }

    // Reorder the sessions to put the one that got the message on top of the list
    state.sessions = new Set([target, ...state.sessions])

    return updateMessages(state, target, true, m => {
      m.push(newMessage)
      return m
    })
  },

  ['@whispers/loadMessageHistory'](state, action) {
    const { target, limit } = action.meta

    const session = state.byId.get(target)
    if (!session) {
      return
    }

    const newMessages = action.payload.messages.map<CommonTextMessage>(msg => ({
      id: msg.id,
      type: CommonMessageType.TextMessage,
      time: msg.time,
      from: msg.from,
      text: msg.text,
    }))

    if (newMessages.length < limit) {
      session.hasHistory = false
    }

    updateMessages(state, target, false, messages => newMessages.concat(messages))
  },

  ['@whispers/activateWhisperSession'](state, action) {
    const { target } = action.payload
    if (!state.byId.has(target)) {
      return
    }

    const session = state.byId.get(target)!
    session.activated = true
    // Message lists mount pinned to the bottom.
    session.atBottom = true
    session.hasUnread = false
  },

  ['@whispers/deactivateWhisperSession'](state, action) {
    const { target } = action.payload
    if (!state.byId.has(target)) {
      return
    }

    const session = state.byId.get(target)!

    const hasHistory = session.messages.length > INACTIVE_SESSION_MAX_HISTORY

    session.messages = session.messages.slice(-INACTIVE_SESSION_MAX_HISTORY)
    session.hasHistory = session.hasHistory || hasHistory
    session.activated = false
    session.atBottom = false
  },

  ['@whispers/updateSessionAtBottom'](state, action) {
    const { target, atBottom } = action.payload
    const session = state.byId.get(target)
    if (!session) {
      return
    }

    const wasAtBottom = session.atBottom
    session.atBottom = atBottom

    if (atBottom && !wasAtBottom) {
      // The user returned to the bottom after reading scrollback that accumulated past the cap;
      // drop it now, where the removal is invisible.
      const hasHistory = session.messages.length > INACTIVE_SESSION_MAX_HISTORY

      session.messages = session.messages.slice(-INACTIVE_SESSION_MAX_HISTORY)
      session.hasHistory = session.hasHistory || hasHistory
    }
  },

  ['@network/connect']() {
    return DEFAULT_STATE
  },
})
