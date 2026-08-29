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
import { ActivateWhisperSession, DeactivateWhisperSession, UpdateSessionAtBottom } from './actions'

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
  return () => {
    reportLastRead(getWhisperLastReadKey(targetId), lastReadTime, time => {
      fetchJson<void>(apiUrl`whispers/${targetId}/mark-read`, {
        method: 'POST',
        body: encodeBodyAsParams<MarkWhisperReadRequest>({ lastReadTime: time }),
      }).catch(err => {
        logger.error(`Error reporting read position for whisper ${targetId}: ${getErrorStack(err)}`)
      })
    })
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
    const earliestMessageTime = sessionData.messages.length ? sessionData.messages[0].time : -1

    dispatch({
      type: '@whispers/loadMessageHistory',
      payload: fetchJson<GetSessionHistoryResponse>(
        apiUrl`whispers/${target}/messages2?limit=${limit}&beforeTime=${earliestMessageTime}`,
      ),
      meta: {
        target,
        limit,
        beforeTime: earliestMessageTime,
      },
    })
  })
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
