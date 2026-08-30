import { Immutable } from 'immer'
import { SbUserId } from '../../common/users/sb-user-id'
import { WhisperMessage } from '../../common/whispers'
import {
  CommonMessageType,
  CommonTextMessage,
  isServerOriginMessage,
} from '../messaging/message-records'
import { immerKeyedReducer } from '../reducers/keyed-reducer'

// How many messages should be kept for inactive channels
const INACTIVE_SESSION_MAX_HISTORY = 150

export interface WhisperSession {
  target: SbUserId
  messages: CommonTextMessage[]

  loadingHistory: boolean
  hasHistory: boolean
  loadingNewer: boolean
  /**
   * Whether messages newer than the loaded window exist on the server, i.e. the window is detached
   * from the present. While this is set, live messages are not appended (they belong on the far
   * side of the gap), and the window is never trimmed.
   */
  hasNewer: boolean
  /**
   * The newest time (epoch ms) of a message that arrived live while the window was detached and so
   * was not appended to it. The window has caught back up to the present only once it has loaded at
   * least this far, which closes the race where a message arrives between the server running the
   * last page's query and this client applying its response.
   */
  detachedNewestTime?: number
  /**
   * Counts how many times the loaded window has been replaced or dropped. Every history request
   * carries the generation it was issued for, and the reducer discards responses that no longer
   * match, since a page has no boundary in common with a window it wasn't fetched for.
   */
  windowGen: number

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
    loadingHistory: false,
    hasHistory: true,
    loadingNewer: false,
    hasNewer: false,
    detachedNewestTime: undefined,
    windowGen: 0,
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

/** Converts messages as the server sends them into the shape the message list renders. */
function toTextMessages(messages: WhisperMessage[]): CommonTextMessage[] {
  return messages.map<CommonTextMessage>(msg => ({
    id: msg.id,
    type: CommonMessageType.TextMessage,
    time: msg.time,
    from: msg.from,
    text: msg.text,
  }))
}

/**
 * Returns the time (epoch ms) of the newest message in `messages` that carries a server-recorded
 * timestamp, or `undefined` if there is none. Only such times can be compared against or handed
 * back to the server.
 */
export function newestServerOriginTime(messages: readonly CommonTextMessage[]): number | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (isServerOriginMessage(messages[i])) {
      return messages[i].time
    }
  }

  return undefined
}

/**
 * Returns `incoming` with every message already present in `existing` removed. The history
 * endpoints seek by millisecond-precision time, so a page boundary landing inside a group of
 * messages that share a timestamp can hand back messages the window already holds.
 */
function dedupeAgainst(
  incoming: CommonTextMessage[],
  existing: readonly CommonTextMessage[],
): CommonTextMessage[] {
  if (!existing.length) {
    return incoming
  }

  const existingIds = new Set(existing.map(m => m.id))
  return incoming.filter(m => !existingIds.has(m.id))
}

/**
 * Records that a message the user hasn't seen has arrived in a whisper session: raises the unread
 * flag and, where applicable, freezes the unread divider. Kept separate from `updateMessages`
 * because a message arriving while the loaded window is detached from the present isn't added to
 * the window at all, yet counts as unread exactly the same.
 */
function markSessionUnread(session: WhisperSession) {
  if (!session.hasUnread && !session.activated) {
    session.hasUnread = true
  }

  // The session is being actively viewed, but the message still won't be seen right away: either
  // the view is scrolled up, or the loaded window sits behind the present, where the bottom of the
  // list isn't the newest message. Freeze the unread divider at the read position so it marks where
  // the user left off instead of chasing the read position as the eager mark-read keeps advancing
  // it.
  if (
    session.activated &&
    (!session.atBottom || session.hasNewer) &&
    session.unreadLineTime === undefined &&
    session.lastReadTime !== undefined
  ) {
    session.unreadLineTime = session.lastReadTime
  }
}

/**
 * Discards everything loaded for a session, returning it to the shape a freshly-opened session has:
 * nothing loaded, older history assumed to exist, attached to the present. Advancing the generation
 * makes the reducer discard any page still in flight for the window that was just dropped.
 */
function dropMessageWindow(session: WhisperSession) {
  session.messages = []
  session.hasHistory = true
  session.hasNewer = false
  session.detachedNewestTime = undefined
  // In-flight requests for the dropped window will be discarded by the generation check when they
  // land, so their loading flags have to be lowered here or they'd stay raised forever.
  session.loadingHistory = false
  session.loadingNewer = false
  session.windowGen += 1
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
  // the viewer is pinned to the bottom, where auto-scroll makes removing top messages invisible. A
  // detached window is never trimmed: the user is paging through it in both directions, and there's
  // no scroll compensation for messages disappearing off its top. Nor is a window with an older
  // page in flight: that page was fetched against the window's current oldest message, and dropping
  // messages from the top before it lands would leave a gap between the two.
  const canTrim =
    !session.hasNewer && !session.loadingHistory && (!session.activated || session.atBottom)

  let sliced = false
  if (canTrim && session.messages.length > INACTIVE_SESSION_MAX_HISTORY) {
    session.messages = session.messages.slice(-INACTIVE_SESSION_MAX_HISTORY)
    sliced = true
  }

  if (makeUnread) {
    markSessionUnread(session)
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

    const session = state.byId.get(target)
    if (session?.hasNewer) {
      // The loaded window sits behind the present, so this message belongs past the gap at its far
      // end rather than at the end of what's loaded. Remembering how far the present has run ahead
      // is what lets the window tell, once it has paged forward, that it has actually caught up.
      session.detachedNewestTime = Math.max(
        session.detachedNewestTime ?? -Infinity,
        newMessage.time,
      )
      markSessionUnread(session)
    } else {
      updateMessages(state, target, true, m => {
        m.push(newMessage)
        return m
      })
    }
  },

  ['@whispers/loadMessageHistoryBegin'](state, action) {
    const { target } = action.payload

    const session = state.byId.get(target)
    if (!session) {
      return
    }

    session.loadingHistory = true
  },

  ['@whispers/loadMessageHistory'](state, action) {
    const { target, windowGen } = action.meta

    const session = state.byId.get(target)
    if (!session || session.windowGen !== windowGen) {
      return
    }

    session.loadingHistory = false

    if (action.error) {
      return
    }

    const newMessages = toTextMessages(action.payload.messages)

    session.hasHistory = action.payload.hasMoreBefore

    updateMessages(state, target, false, messages =>
      dedupeAgainst(newMessages, messages).concat(messages),
    )
  },

  ['@whispers/loadNewerMessagesBegin'](state, action) {
    const { target } = action.payload

    const session = state.byId.get(target)
    if (!session) {
      return
    }

    session.loadingNewer = true
  },

  ['@whispers/loadNewerMessages'](state, action) {
    const { target, windowGen } = action.meta

    const session = state.byId.get(target)
    if (!session || session.windowGen !== windowGen) {
      return
    }

    session.loadingNewer = false

    if (action.error) {
      return
    }

    const newMessages = toTextMessages(action.payload.messages)

    updateMessages(state, target, false, messages =>
      messages.concat(dedupeAgainst(newMessages, messages)),
    )

    // Rejoining the present takes both the server saying nothing is newer and the window having
    // reached everything that arrived live while it was detached. A message sent between the server
    // running this page's query and this response landing leaves the window one page short, so
    // `hasNewer` stays set and the list's next-edge sentinel asks again until it converges. The
    // exception is a request issued when this client already knew of the messages it's waiting on:
    // live messages are only announced after they're stored, so such a request's query ran late
    // enough to see them, and them being absent from the response means they've since been deleted.
    // Attaching then (rather than holding out for a time no remaining message will ever reach)
    // keeps a deletion from turning the sentinel's retries into an endless loop.
    if (!action.payload.hasMoreAfter) {
      const newestLoadedTime = newestServerOriginTime(session.messages)
      const { detachedNewestTime } = session
      if (
        detachedNewestTime === undefined ||
        (newestLoadedTime !== undefined && newestLoadedTime >= detachedNewestTime) ||
        detachedNewestTime <= action.meta.knownNewestTime
      ) {
        session.hasNewer = false
        session.detachedNewestTime = undefined
      }
    }
  },

  ['@whispers/loadMessagesAroundBegin'](state, action) {
    const { target } = action.payload

    const session = state.byId.get(target)
    if (!session) {
      return
    }

    // The whole window is about to be replaced, so there's no one edge the wait belongs to; the
    // older edge's affordance stands in for both.
    session.loadingHistory = true
  },

  ['@whispers/loadMessagesAround'](state, action) {
    const { target, windowGen } = action.meta

    const session = state.byId.get(target)
    if (!session || session.windowGen !== windowGen) {
      return
    }

    session.loadingHistory = false
    session.loadingNewer = false

    if (action.error) {
      return
    }

    // Everything this client knows the present ran at least as far as: the newest message it had
    // loaded (live messages keep appending to an attached window while the request is in flight)
    // and the newest it observed while detached. The replacement window has caught up to the
    // present only if it reaches this far.
    const knownNewest = Math.max(
      newestServerOriginTime(session.messages) ?? -Infinity,
      session.detachedNewestTime ?? -Infinity,
    )

    // The fetched range doesn't have to touch what was loaded, so there may be no seam to splice
    // them together at and the window is replaced outright.
    session.messages = toTextMessages(action.payload.messages)
    session.hasHistory = action.payload.hasMoreBefore
    session.windowGen += 1

    if (action.payload.hasMoreAfter) {
      session.hasNewer = true
      session.detachedNewestTime = knownNewest === -Infinity ? undefined : knownNewest
    } else {
      // The server saw nothing newer than the replacement window, but a message that arrived
      // between its query running and this response landing exists only past the window's newer
      // edge, so the window must stay detached and page forward to it. A message this client
      // already knew of when the request was issued is the exception: the query ran late enough to
      // have seen it, so its absence means it's been deleted (see the matching reasoning where
      // newer pages land).
      const newestLoadedTime = newestServerOriginTime(session.messages) ?? -Infinity
      const knownNewestAtDispatch = action.meta.knownNewestTime ?? -Infinity
      if (newestLoadedTime < knownNewest && knownNewest > knownNewestAtDispatch) {
        session.hasNewer = true
        session.detachedNewestTime = knownNewest
      } else {
        session.hasNewer = false
        session.detachedNewestTime = undefined
      }
    }
  },

  ['@whispers/resetMessageWindow'](state, action) {
    const { target } = action.payload

    const session = state.byId.get(target)
    if (!session) {
      return
    }

    dropMessageWindow(session)
  },

  ['@whispers/activateWhisperSession'](state, action) {
    const { target, restoredUnreadLineTime } = action.payload
    if (!state.byId.has(target)) {
      return
    }

    const session = state.byId.get(target)!

    // Whether the view is opening at the newest messages. The view reports where its viewport
    // settles (`updateSessionAtBottom`) ahead of this dispatch, so the current flag reflects this
    // activation's viewport; a view still on its way back to a saved reading position hasn't
    // reported yet and counts as away from the bottom, which is where it's headed.
    const atBottom = session.atBottom

    // A divider from a previous session stands in for one this session never had a chance to
    // freeze. It goes in ahead of everything else that looks at the divider, so the rules for
    // freezing and consuming it treat it no differently from one frozen here.
    if (restoredUnreadLineTime !== undefined && session.unreadLineTime === undefined) {
      session.unreadLineTime = restoredUnreadLineTime
    }

    // Freeze the unread divider at the read position before clearing the unread flag, so the
    // divider marks where the user left off instead of where the read position ends up after the
    // eager mark-read opening at the newest messages triggers.
    if (
      session.hasUnread &&
      session.unreadLineTime === undefined &&
      session.lastReadTime !== undefined
    ) {
      session.unreadLineTime = session.lastReadTime
    }

    // A divider the read position has already moved past outlives that only for as long as the
    // view keeps returning to where the user stopped reading; opening at the newest messages means
    // they're caught up and the divider has served its purpose.
    if (
      atBottom &&
      session.unreadLineTime !== undefined &&
      session.lastReadTime !== undefined &&
      session.lastReadTime > session.unreadLineTime
    ) {
      session.unreadLineTime = undefined
    }

    session.activated = true
    session.hasUnread = false
  },

  ['@whispers/deactivateWhisperSession'](state, action) {
    const { target } = action.payload
    if (!state.byId.has(target)) {
      return
    }

    const session = state.byId.get(target)!

    // The unread divider is only consumed once the read position has actually moved past it *and*
    // the user was looking at the newest messages when they left. A deactivation where they never
    // read anything new (including the mount/cleanup/remount cycle React's StrictMode runs in
    // development) leaves the still-unread divider in place, and so does one from the middle of the
    // backlog, where the read position running ahead is an artifact of having passed the bottom on
    // the way in rather than of having caught up. The bottom of a detached window is only the end
    // of what's loaded rather than the newest message, so leaving from there is such a mid-backlog
    // leave no matter what the at-bottom flag says.
    if (
      session.atBottom &&
      !session.hasNewer &&
      session.unreadLineTime !== undefined &&
      session.lastReadTime !== undefined &&
      session.lastReadTime > session.unreadLineTime
    ) {
      session.unreadLineTime = undefined
    }

    session.activated = false
    session.atBottom = false

    if (session.hasNewer) {
      // Keeping a window that sits mid-history would put the user back where they were reading with
      // no indication that the conversation has run on past it, so a detached window is dropped
      // whole and the next visit starts from the present like any other fresh open.
      dropMessageWindow(session)
    } else {
      const hasHistory = session.messages.length > INACTIVE_SESSION_MAX_HISTORY

      if (session.loadingHistory || session.loadingNewer) {
        // A page in flight was fetched against the window's edges, which the trim below moves;
        // applying it afterwards would splice it in ahead of a gap in the middle of the history.
        // Advancing the generation makes it be discarded when it lands, which costs nothing with
        // the view gone. Lowering the flags then has to happen here too, since the discarded page
        // no longer lowers them itself and a request that never settles never would.
        session.windowGen += 1
      }
      session.loadingHistory = false
      session.loadingNewer = false

      session.messages = session.messages.slice(-INACTIVE_SESSION_MAX_HISTORY)
      session.hasHistory = session.hasHistory || hasHistory
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

    if (atBottom && !wasAtBottom && !session.hasNewer && !session.loadingHistory) {
      // The user returned to the bottom after reading scrollback that accumulated past the cap;
      // drop it now, where the removal is invisible. For a detached window the bottom is only the
      // end of what's loaded rather than the newest message, and the user is still paging through
      // it, so nothing is dropped there. An older page in flight was fetched against the window's
      // current oldest message, so trimming past it would leave that page splicing in ahead of a
      // gap; the trim waits for the page instead, since the list is on screen and discarding the
      // page by advancing the generation would read as the window being replaced under the user.
      const hasHistory = session.messages.length > INACTIVE_SESSION_MAX_HISTORY

      session.messages = session.messages.slice(-INACTIVE_SESSION_MAX_HISTORY)
      session.hasHistory = session.hasHistory || hasHistory
    }
  },

  // This arrives both from this session's own optimistic mark-read reports (dispatched only while
  // the session is activated) and from the socket handler relaying a mark-read made in one of the
  // user's other sessions (which can arrive for a session this session isn't currently viewing).
  // The unread flag and frozen divider are only re-evaluated in the latter case: an activated
  // session already has its unread flag cleared, and its divider is re-evaluated by
  // `deactivateWhisperSession` instead, so it must never move while the session is being viewed
  // here.
  ['@whispers/updateLastReadTime'](state, action) {
    const { targetId, lastReadTime } = action.payload

    const session = state.byId.get(targetId)
    if (!session) {
      return
    }

    if (session.lastReadTime === undefined || lastReadTime > session.lastReadTime) {
      session.lastReadTime = lastReadTime
    }
    const effective = session.lastReadTime!

    if (!session.activated) {
      const newestKnownTime = newestServerOriginTime(session.messages)
      if (newestKnownTime === undefined || newestKnownTime <= effective) {
        session.hasUnread = false
      }

      if (session.unreadLineTime !== undefined && effective > session.unreadLineTime) {
        session.unreadLineTime = undefined
      }
    }
  },

  ['@network/connect']() {
    return DEFAULT_STATE
  },
})
