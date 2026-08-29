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
  /**
   * The client's view of the server-recorded read position (epoch ms) for this session. Seeded
   * from the server at init, and advanced optimistically whenever the client reports a mark-read
   * for the session.
   */
  lastReadTime?: number
  /**
   * The frozen position of the unread divider for the current activation. Captured when an unread
   * session activates, or when a message arrives while the session is activated and scrolled up,
   * and held until deactivation so the divider doesn't chase `lastReadTime` as it keeps advancing
   * underneath it.
   */
  unreadLineTime?: number
}

function defaultWhisperSession(target: SbUserId): WhisperSession {
  return {
    target,
    messages: [],
    hasHistory: true,
    activated: false,
    atBottom: false,
    hasUnread: false,
    lastReadTime: undefined,
    unreadLineTime: undefined,
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

  // The session is being actively viewed but scrolled up, so a new message won't be seen right
  // away. Freeze the unread divider at the read position so it marks where the user left off
  // instead of chasing the read position as the eager mark-read keeps advancing it.
  if (
    makeUnread &&
    session.activated &&
    !session.atBottom &&
    session.unreadLineTime === undefined &&
    session.lastReadTime !== undefined
  ) {
    session.unreadLineTime = session.lastReadTime
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

    // Seeds the unread badge from the server's recorded read position, so it survives a restart
    // instead of resetting to "read" until the next message arrives. A session the user is
    // currently viewing is never marked unread, matching how a live message never marks an
    // activated session unread either.
    for (const target of action.payload.unreadSessions ?? []) {
      const session = state.byId.get(target)
      if (session && !session.activated) {
        session.hasUnread = true
      }
    }

    // Seeds each session's read position from the server, so the unread divider has somewhere to
    // freeze at even before any local mark-read report has happened this session.
    for (const { targetId, lastReadTime } of action.payload.lastReadTimes ?? []) {
      const session = state.byId.get(targetId)
      if (session) {
        session.lastReadTime = lastReadTime
      }
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

    // Freeze the unread divider at the read position before clearing the unread flag, so the
    // divider marks where the user left off instead of where the read position ends up after the
    // eager mark-read this activation triggers.
    if (
      session.hasUnread &&
      session.unreadLineTime === undefined &&
      session.lastReadTime !== undefined
    ) {
      session.unreadLineTime = session.lastReadTime
    }

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
    // The unread divider is only consumed once the read position has actually moved past it — a
    // deactivation where the user never read anything new (including the mount/cleanup/remount
    // cycle React's StrictMode runs in development) leaves the still-unread divider in place for
    // the next visit.
    if (
      session.unreadLineTime !== undefined &&
      session.lastReadTime !== undefined &&
      session.lastReadTime > session.unreadLineTime
    ) {
      session.unreadLineTime = undefined
    }
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

  ['@whispers/updateLastReadTime'](state, action) {
    const { targetId, lastReadTime } = action.payload

    const session = state.byId.get(targetId)
    if (!session) {
      return
    }

    if (session.lastReadTime === undefined || lastReadTime > session.lastReadTime) {
      session.lastReadTime = lastReadTime
    }
  },

  ['@network/connect']() {
    return DEFAULT_STATE
  },
})
