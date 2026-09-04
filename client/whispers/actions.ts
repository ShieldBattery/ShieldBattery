import { SbUserId } from '../../common/users/sb-user-id'
import {
  GetSessionHistoryResponse,
  GetWhisperMessageLinkResponse,
  GetWhisperSessionsResponse,
  WhisperMessageEvent,
} from '../../common/whispers'
import { BaseFetchFailure } from '../network/fetch-errors'

export type WhisperActions =
  | LoadMessageHistoryBegin
  | LoadMessageHistory
  | LoadMessageHistoryFailure
  | LoadNewerMessagesBegin
  | LoadNewerMessages
  | LoadNewerMessagesFailure
  | LoadMessagesAroundBegin
  | LoadMessagesAround
  | LoadMessagesAroundFailure
  | ResetMessageWindow
  | ActivateWhisperSession
  | DeactivateWhisperSession
  | UpdateSessionAtBottom
  | WhisperSessionInit
  | WhisperSessionClose
  | WhisperMessageUpdate
  | GetWhisperSessions
  | UpdateLastReadTime
  | ResolveWhisperMessageLink

/**
 * Get the list of whisper sessions for the current user.
 */
export interface GetWhisperSessions {
  type: '@whispers/getWhisperSessions'
  payload: GetWhisperSessionsResponse
}

export interface LoadMessageHistoryBegin {
  type: '@whispers/loadMessageHistoryBegin'
  payload: {
    target: SbUserId
    limit: number
    beforeTime: number
    /**
     * The generation of the loaded message window this page was requested for. The reducer drops
     * pages whose generation no longer matches the session's, since a window that has since been
     * replaced or dropped shares no boundary with them.
     */
    windowGen: number
  }
}

/**
 * Load the `limit` amount of messages in a whisper session before a particular time.
 */
export interface LoadMessageHistory {
  type: '@whispers/loadMessageHistory'
  payload: GetSessionHistoryResponse
  meta: {
    target: SbUserId
    limit: number
    beforeTime: number
    /**
     * The generation of the loaded message window this page was requested for. The reducer drops
     * pages whose generation no longer matches the session's, since a window that has since been
     * replaced or dropped shares no boundary with them.
     */
    windowGen: number
  }
  error?: false
}

export interface LoadMessageHistoryFailure extends BaseFetchFailure<'@whispers/loadMessageHistory'> {
  meta: {
    target: SbUserId
    limit: number
    beforeTime: number
    windowGen: number
  }
}

export interface LoadNewerMessagesBegin {
  type: '@whispers/loadNewerMessagesBegin'
  payload: {
    target: SbUserId
    limit: number
    afterTime: number
    windowGen: number
    /**
     * The newest server-recorded message time (epoch ms) this client knew existed when the request
     * was dispatched, whether loaded or only observed live. Responses that report nothing newer are
     * authoritative for messages known this early — the server announces messages only after
     * storing them — so their absence proves deletion rather than a race.
     */
    knownNewestTime: number
  }
}

/**
 * Load the `limit` oldest messages in a whisper session that are newer than a particular time,
 * extending a loaded window that sits behind the present toward it.
 */
export interface LoadNewerMessages {
  type: '@whispers/loadNewerMessages'
  payload: GetSessionHistoryResponse
  meta: {
    target: SbUserId
    limit: number
    afterTime: number
    windowGen: number
    /**
     * The newest server-recorded message time (epoch ms) this client knew existed when the request
     * was dispatched, whether loaded or only observed live. Responses that report nothing newer are
     * authoritative for messages known this early — the server announces messages only after
     * storing them — so their absence proves deletion rather than a race.
     */
    knownNewestTime: number
  }
  error?: false
}

export interface LoadNewerMessagesFailure extends BaseFetchFailure<'@whispers/loadNewerMessages'> {
  meta: {
    target: SbUserId
    limit: number
    afterTime: number
    windowGen: number
    /**
     * The newest server-recorded message time (epoch ms) this client knew existed when the request
     * was dispatched, whether loaded or only observed live. Responses that report nothing newer are
     * authoritative for messages known this early — the server announces messages only after
     * storing them — so their absence proves deletion rather than a race.
     */
    knownNewestTime: number
  }
}

export interface LoadMessagesAroundBegin {
  type: '@whispers/loadMessagesAroundBegin'
  payload: {
    target: SbUserId
    limit: number
    /** The time the window was asked for around, when the request named a time. */
    aroundTime?: number
    /** The message the window was asked for around, when the request named a message. */
    aroundMessageId?: string
    windowGen: number
    /**
     * The newest server-recorded message time (epoch ms) this client knew existed when the request
     * was dispatched, whether loaded or only observed live, or `undefined` when it knew of none.
     * Responses that report nothing newer are authoritative for messages known this early — the
     * server announces messages only after storing them — so their absence proves deletion rather
     * than a race.
     */
    knownNewestTime: number | undefined
  }
}

/**
 * Load a window of up to `limit` messages in a whisper session centered on a particular point in
 * its history, named either by time or by one of its messages. The result replaces whatever was
 * loaded for the session, since the fetched range doesn't have to touch it.
 */
export interface LoadMessagesAround {
  type: '@whispers/loadMessagesAround'
  payload: GetSessionHistoryResponse
  meta: {
    target: SbUserId
    limit: number
    /** The time the window was asked for around, when the request named a time. */
    aroundTime?: number
    /** The message the window was asked for around, when the request named a message. */
    aroundMessageId?: string
    windowGen: number
    /**
     * The newest server-recorded message time (epoch ms) this client knew existed when the request
     * was dispatched, whether loaded or only observed live, or `undefined` when it knew of none.
     * Responses that report nothing newer are authoritative for messages known this early — the
     * server announces messages only after storing them — so their absence proves deletion rather
     * than a race.
     */
    knownNewestTime: number | undefined
  }
  error?: false
}

export interface LoadMessagesAroundFailure extends BaseFetchFailure<'@whispers/loadMessagesAround'> {
  meta: {
    target: SbUserId
    limit: number
    /** The time the window was asked for around, when the request named a time. */
    aroundTime?: number
    /** The message the window was asked for around, when the request named a message. */
    aroundMessageId?: string
    windowGen: number
    /**
     * The newest server-recorded message time (epoch ms) this client knew existed when the request
     * was dispatched, whether loaded or only observed live, or `undefined` when it knew of none.
     * Responses that report nothing newer are authoritative for messages known this early — the
     * server announces messages only after storing them — so their absence proves deletion rather
     * than a race.
     */
    knownNewestTime: number | undefined
  }
}

/**
 * Discard everything loaded for a whisper session, returning it to the state a freshly-opened
 * session is in: nothing loaded, older history assumed to exist, and attached to the present so
 * live messages append again.
 */
export interface ResetMessageWindow {
  type: '@whispers/resetMessageWindow'
  payload: {
    target: SbUserId
  }
}

/**
 * Activate a particular whisper session. This is a purely client-side action which marks the
 * session as "active", and removes the unread indicator if there is one. The message list reports
 * the at-bottom state it opened in (`UpdateSessionAtBottom`) ahead of this being dispatched, so
 * the reducer reads the current flag to tell an open at the newest messages from one restoring a
 * position further back.
 */
export interface ActivateWhisperSession {
  type: '@whispers/activateWhisperSession'
  payload: {
    target: SbUserId
  }
}

/**
 * Deactivate a particular whisper session. This is a purely client-side action which unloads the
 * message history of a session and thus frees up some memory.
 */
export interface DeactivateWhisperSession {
  type: '@whispers/deactivateWhisperSession'
  payload: {
    target: SbUserId
  }
}

/**
 * Update whether a viewed whisper session's message list is scrolled to the bottom. This is a
 * purely client-side action; the reducer uses it to trim message history down to the same cap
 * applied to inactive sessions, since removing old messages while pinned to the bottom is
 * invisible to the user (auto-scroll keeps the view at the newest message).
 */
export interface UpdateSessionAtBottom {
  type: '@whispers/updateSessionAtBottom'
  payload: {
    target: SbUserId
    atBottom: boolean
  }
}

/**
 * The client's read position for a whisper session has advanced. Dispatched optimistically when
 * this session reports a mark-read, and by the socket handler when the server relays a read
 * position update from one of the user's other sessions.
 */
export interface UpdateLastReadTime {
  type: '@whispers/updateLastReadTime'
  payload: {
    targetId: SbUserId
    lastReadTime: number
  }
}

/**
 * We have started a new whisper session with a particular user and the server has sent us some
 * initial data.
 */
export interface WhisperSessionInit {
  type: '@whispers/initSession'
  payload: {
    target: SbUserId
  }
}

/**
 * We have closed a whisper session with a particular user.
 */
export interface WhisperSessionClose {
  type: '@whispers/closeSession'
  payload: {
    target: SbUserId
  }
}

/**
 * We have received a message from a user in one of our whisper sessions.
 */
export interface WhisperMessageUpdate {
  type: '@whispers/updateMessage'
  payload: WhisperMessageEvent
  meta: {
    /** The other user involved in this whisper (not the one logged in on this client). */
    target: SbUserId
    /**
     * Whether the app window was focused when the message arrived. A message landing in an
     * unfocused window can't have been seen no matter where the session's view is scrolled, so the
     * reducer counts it as unread regardless.
     */
    windowFocused: boolean
  }
}

/**
 * A whisper message link was resolved to the conversation it belongs to.
 */
export interface ResolveWhisperMessageLink {
  type: '@whispers/resolveMessageLink'
  payload: GetWhisperMessageLinkResponse
}
