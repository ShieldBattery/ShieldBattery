import { SbUser } from '../../common/users/user-info'
import { GetSessionHistoryServerPayload, WhisperUserStatus } from '../../common/whispers'
import { BaseFetchFailure } from '../network/fetch-action-types'

export type WhisperActions =
  | StartWhisperSessionBegin
  | StartWhisperSession
  | StartWhisperSessionFailure
  | CloseWhisperSessionBegin
  | CloseWhisperSession
  | CloseWhisperSessionFailure
  | SendMessageBegin
  | SendMessage
  | SendMessageFailure
  | LoadMessageHistoryBegin
  | LoadMessageHistory
  | LoadMessageHistoryFailure
  | ActivateWhisperSession
  | DeactivateWhisperSession
  | WhisperSessionInit
  | WhisperSessionClose
  | WhisperMessageUpdate
  | WhisperUserActive
  | WhisperUserIdle
  | WhisperUserOffline

export interface StartWhisperSessionBegin {
  type: '@whispers/startWhisperSessionBegin'
  payload: {
    target: string
  }
}

/**
 * Start a whisper session with another user. Whisper session is basically a communication channel
 * between two users (a la "chat channels" in chat), which is required before sending any messages
 * to someone else. Sending a message directly to someone (e.g. by using a chat command) will start
 * a whisper session implicitly. Starting a whisper session explicitly (e.g. by clicking the
 * "Whisper" action in someone's profile) will open a window with whisper history for that user.
 */
export interface StartWhisperSession {
  type: '@whispers/startWhisperSession'
  payload: void
  meta: {
    target: string
  }
  error?: false
}

export interface StartWhisperSessionFailure
  extends BaseFetchFailure<'@whispers/startWhisperSession'> {
  meta: {
    target: string
  }
}

export interface CloseWhisperSessionBegin {
  type: '@whispers/closeWhisperSessionBegin'
  payload: {
    target: string
  }
}

/**
 * Close a whisper session with another user. See the comment above on what whisper session actually
 * represents. This only closes the current whisper session with another user; the whisper history
 * will be preserved and shown when the session starts again.
 */
export interface CloseWhisperSession {
  type: '@whispers/closeWhisperSession'
  payload: void
  meta: {
    target: string
  }
  error?: false
}

export interface CloseWhisperSessionFailure
  extends BaseFetchFailure<'@whispers/closeWhisperSession'> {
  meta: {
    target: string
  }
}

export interface SendMessageBegin {
  type: '@whispers/sendMessageBegin'
  payload: {
    target: string
    message: string
  }
}

/**
 * Send a whisper message to another user. As said in above comment, this action will implicitly
 * start a whisper session with that user first, if it wasn't already.
 */
export interface SendMessage {
  type: '@whispers/sendMessage'
  payload: void
  meta: {
    target: string
    message: string
  }
  error?: false
}

export interface SendMessageFailure extends BaseFetchFailure<'@whispers/sendMessage'> {
  meta: {
    target: string
    message: string
  }
}

export interface LoadMessageHistoryBegin {
  type: '@whispers/loadMessageHistoryBegin'
  payload: {
    target: string
    limit: number
    beforeTime: number
  }
}

/**
 * Load the `limit` amount of messages in a whisper session before a particular time.
 */
export interface LoadMessageHistory {
  type: '@whispers/loadMessageHistory'
  payload: GetSessionHistoryServerPayload
  meta: {
    target: string
    limit: number
    beforeTime: number
  }
  error?: false
}

export interface LoadMessageHistoryFailure
  extends BaseFetchFailure<'@whispers/loadMessageHistory'> {
  meta: {
    target: string
    limit: number
    beforeTime: number
  }
}

/**
 * Activate a particular whisper session. This is a purely client-side action which marks the
 * session as "active", and removes the unread indicator if there is one.
 */
export interface ActivateWhisperSession {
  type: '@whispers/activateWhisperSession'
  payload: {
    target: string
  }
}

/**
 * Deactivate a particular whisper session. This is a purely client-side action which unloads the
 * message history of a session and thus frees up some memory.
 */
export interface DeactivateWhisperSession {
  type: '@whispers/deactivateWhisperSession'
  payload: {
    target: string
  }
}

/**
 * We have started a new whisper session with a particular user and the server has sent us some
 * initial data.
 */
export interface WhisperSessionInit {
  type: '@whispers/initSession'
  payload: {
    target: SbUser
    targetStatus: WhisperUserStatus
  }
}

/**
 * We have closed a whisper session with a particular user.
 */
export interface WhisperSessionClose {
  type: '@whispers/closeSession'
  payload: {
    target: SbUser
  }
}

/**
 * We have received a message from a user in one of our whisper sessions.
 */
export interface WhisperMessageUpdate {
  type: '@whispers/updateMessage'
  payload: {
    message: {
      id: string
      time: number
      from: SbUser
      to: SbUser
      text: string
      isHighlighted: boolean
    }
    users: SbUser[]
  }
}

/**
 * A user in one of our whisper sessions has become active (non-idle and online)
 */
export interface WhisperUserActive {
  type: '@whispers/updateUserActive'
  payload: {
    user: SbUser
  }
}

/**
 * A user in one of our whisper sessions has become idle (still online, but not active)
 */
export interface WhisperUserIdle {
  type: '@whispers/updateUserIdle'
  payload: {
    user: SbUser
  }
}

/**
 * A user in one of our whisper sessions has gone offline
 */
export interface WhisperUserOffline {
  type: '@whispers/updateUserOffline'
  payload: {
    user: SbUser
  }
}
