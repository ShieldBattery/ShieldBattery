import { getErrorStack } from '../../common/errors'
import { apiUrl, urlPath } from '../../common/urls'
import { SbUserId } from '../../common/users/sb-user-id'
import {
  GetSessionHistoryResponse,
  GetWhisperSessionsResponse,
  MarkWhisperReadRequest,
  SendWhisperMessageRequest,
} from '../../common/whispers'
import { ThunkAction } from '../dispatch-registry'
import logger from '../logging/logger'
import { reportLastRead } from '../messaging/last-read'
import { push, replace } from '../navigation/routing'
import { RequestHandlingSpec, abortableThunk } from '../network/abortable-thunk'
import { encodeBodyAsParams, fetchJson } from '../network/fetch'
import {
  ActivateWhisperSession,
  DeactivateWhisperSession,
  ResetMessageWindow,
  UpdateSessionAtBottom,
} from './actions'
import { newestServerOriginTime } from './whisper-reducer'

export function getWhisperSessions(spec: RequestHandlingSpec<void>): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    const result = await fetchJson<GetWhisperSessionsResponse>(apiUrl`whispers/sessions`, {
      method: 'GET',
      signal: spec.signal,
    })

    dispatch({
      type: '@whispers/getWhisperSessions',
      payload: result,
    })
  })
}

/** The `reportLastRead`/`flushLastRead` coalescing key for a whisper conversation's read position. */
export function getWhisperLastReadKey(targetId: SbUserId): string {
  return `whisper-${targetId}`
}

/**
 * Reports the newest message time the current user has read in a whisper conversation, coalescing
 * rapid-fire reports (see `reportLastRead`). Fire-and-forget: there's no `RequestHandlingSpec` since
 * nothing needs to react to this request's outcome.
 */
export function markWhisperRead(targetId: SbUserId, lastReadTime: number): ThunkAction {
  return dispatch => {
    // Advances the local read position immediately; the reducer's monotonic guard keeps this
    // correct even for reports the coalescer below ends up dropping.
    dispatch({
      type: '@whispers/updateLastReadTime',
      payload: { targetId, lastReadTime },
    })

    // The rejection is passed back out so the coalescer knows the position never landed and lets
    // the next report carry it again.
    reportLastRead(getWhisperLastReadKey(targetId), lastReadTime, time =>
      fetchJson<void>(apiUrl`whispers/${targetId}/mark-read`, {
        method: 'POST',
        body: encodeBodyAsParams<MarkWhisperReadRequest>({ lastReadTime: time }),
      }).catch(err => {
        logger.error(`Error reporting read position for whisper ${targetId}: ${getErrorStack(err)}`)
        throw err
      }),
    )
  }
}

export function startWhisperSessionByName(
  target: string,
  spec: RequestHandlingSpec<{ userId: SbUserId }>,
): ThunkAction {
  return abortableThunk(spec, async () => {
    return fetchJson<{ userId: SbUserId }>(apiUrl`whispers/by-name/${target}`, {
      method: 'POST',
      signal: spec.signal,
    })
  })
}

export function startWhisperSessionById(target: SbUserId, spec: RequestHandlingSpec): ThunkAction {
  return abortableThunk(spec, async () => {
    return fetchJson<void>(apiUrl`whispers/${target}`, {
      method: 'POST',
      signal: spec.signal,
    })
  })
}

export function closeWhisperSession(target: SbUserId, spec: RequestHandlingSpec): ThunkAction {
  return abortableThunk(spec, async () => {
    return fetchJson<void>(apiUrl`whispers/${target}`, {
      method: 'DELETE',
      signal: spec.signal,
    })
  })
}

export function sendMessage(
  target: SbUserId,
  message: string,
  spec: RequestHandlingSpec,
): ThunkAction {
  return abortableThunk(spec, async () => {
    return fetchJson<void>(apiUrl`whispers/${target}/messages`, {
      method: 'POST',
      body: encodeBodyAsParams<SendWhisperMessageRequest>({ message }),
    })
  })
}

export function getMessageHistory(
  target: SbUserId,
  limit: number,
  spec: RequestHandlingSpec,
): ThunkAction {
  return abortableThunk(spec, async (dispatch, getStore) => {
    const {
      whispers: { byId },
    } = getStore()
    if (!byId.has(target)) {
      return
    }

    const sessionData = byId.get(target)!
    // -1 is the "newest page" sentinel for when nothing is loaded. Every whisper message the client
    // holds is a server-recorded text message, so the oldest one is always a usable cursor.
    const earliestMessageTime = sessionData.messages.length ? sessionData.messages[0].time : -1
    const params = {
      target,
      limit,
      beforeTime: earliestMessageTime,
      windowGen: sessionData.windowGen,
    }

    const promise = fetchJson<GetSessionHistoryResponse>(
      apiUrl`whispers/${target}/messages2?limit=${limit}&beforeTime=${earliestMessageTime}`,
    )
    dispatch({
      type: '@whispers/loadMessageHistoryBegin',
      payload: params,
    })
    dispatch({
      type: '@whispers/loadMessageHistory',
      payload: promise,
      meta: params,
    })
    await promise
  })
}

/**
 * Loads the page of messages that follows the newest one currently loaded for a session, moving a
 * window that sits behind the present a page closer to it. Does nothing if the session holds no
 * message with a server-recorded time, since there'd be nothing the server could seek from.
 */
export function getNewerMessages(
  target: SbUserId,
  limit: number,
  spec: RequestHandlingSpec,
): ThunkAction {
  return abortableThunk(spec, async (dispatch, getStore) => {
    const {
      whispers: { byId },
    } = getStore()
    const sessionData = byId.get(target)
    if (!sessionData) {
      return
    }

    const afterTime = newestServerOriginTime(sessionData.messages)
    if (afterTime === undefined) {
      return
    }

    const params = {
      target,
      limit,
      afterTime,
      windowGen: sessionData.windowGen,
      knownNewestTime: Math.max(afterTime, sessionData.detachedNewestTime ?? -Infinity),
    }

    const promise = fetchJson<GetSessionHistoryResponse>(
      apiUrl`whispers/${target}/messages2?limit=${limit}&afterTime=${afterTime}`,
    )
    dispatch({
      type: '@whispers/loadNewerMessagesBegin',
      payload: params,
    })
    dispatch({
      type: '@whispers/loadNewerMessages',
      payload: promise,
      meta: params,
    })
    await promise
  })
}

/**
 * Loads a window of messages centered on `aroundTime`, replacing whatever is currently loaded for
 * the session. This is how the client reaches a position that isn't adjacent to what it holds, such
 * as an unread divider that sits further back than the loaded history reaches.
 */
export function getMessagesAround(
  target: SbUserId,
  limit: number,
  aroundTime: number,
  spec: RequestHandlingSpec,
): ThunkAction {
  return abortableThunk(spec, async (dispatch, getStore) => {
    const {
      whispers: { byId },
    } = getStore()
    const sessionData = byId.get(target)
    if (!sessionData) {
      return
    }

    const knownNewest = Math.max(
      newestServerOriginTime(sessionData.messages) ?? -Infinity,
      sessionData.detachedNewestTime ?? -Infinity,
    )
    const params = {
      target,
      limit,
      aroundTime,
      windowGen: sessionData.windowGen,
      knownNewestTime: knownNewest === -Infinity ? undefined : knownNewest,
    }

    const promise = fetchJson<GetSessionHistoryResponse>(
      apiUrl`whispers/${target}/messages2?limit=${limit}&aroundTime=${aroundTime}`,
    )
    dispatch({
      type: '@whispers/loadMessagesAroundBegin',
      payload: params,
    })
    dispatch({
      type: '@whispers/loadMessagesAround',
      payload: promise,
      meta: params,
    })
    await promise
  })
}

export function resetMessageWindow(target: SbUserId): ResetMessageWindow {
  return {
    type: '@whispers/resetMessageWindow',
    payload: { target },
  }
}

/**
 * Returns a session's message list to the present, however far back it was left. The loaded window
 * is dropped and the newest page requested in the same tick, so the list never renders an empty
 * conversation in between.
 */
export function jumpToPresent(
  target: SbUserId,
  limit: number,
  spec: RequestHandlingSpec,
): ThunkAction {
  return dispatch => {
    dispatch(resetMessageWindow(target))
    dispatch(getMessageHistory(target, limit, spec))
  }
}

export function activateWhisperSession(target: SbUserId): ActivateWhisperSession {
  return {
    type: '@whispers/activateWhisperSession',
    payload: { target },
  }
}

export function deactivateWhisperSession(target: SbUserId): DeactivateWhisperSession {
  return {
    type: '@whispers/deactivateWhisperSession',
    payload: { target },
  }
}

export function updateSessionAtBottom(target: SbUserId, atBottom: boolean): UpdateSessionAtBottom {
  return {
    type: '@whispers/updateSessionAtBottom',
    payload: { target, atBottom },
  }
}

export function navigateToWhisper(targetId: SbUserId, targetName: string, transitionFn = push) {
  transitionFn(urlPath`/whispers/${targetId}/${targetName}`)
}

/**
 * Corrects the URL for a whisper to a specific user if it is already being viewed. This is meant to
 * be used when the client arrived on the page but the username doesn't match what we have stored
 * for their user ID.
 */
export function correctUsernameForWhisper(userId: SbUserId, username: string) {
  replace(urlPath`/whispers/${userId}/${username}`)
}
