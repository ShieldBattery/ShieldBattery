import { apiUrl, urlPath } from '../../common/urls'
import {
  GetBatchUserInfoResponse,
  GetUserProfileResponse,
  SbUserId,
} from '../../common/users/user-info'
import { ThunkAction } from '../dispatch-registry'
import logger from '../logging/logger'
import { push, replace } from '../navigation/routing'
import { abortableThunk, RequestHandlingSpec } from '../network/abortable-thunk'
import { MicrotaskBatchRequester } from '../network/batch-requests'
import { fetchJson } from '../network/fetch'
import { UserProfileSubPage } from './user-profile-sub-page'

/**
 * Navigates to a specific user's profile (and optionally, a specific tab within that).
 */
export function navigateToUserProfile(
  userId: SbUserId,
  username: string,
  tab?: UserProfileSubPage,
) {
  push(urlPath`/users/${userId}/${username}/${tab ?? ''}`)
}

/**
 * Corrects the URL for a specific user's profile if it is already being viewed. This is meant to be
 * used when the client arrived on the page bu the username doesn't match what we have stored for
 * their user ID.
 */
export function correctUsernameForProfile(
  userId: SbUserId,
  username: string,
  tab?: UserProfileSubPage,
) {
  replace(urlPath`/users/${userId}/${username}/${tab ?? ''}`)
}

const userProfileLoadsInProgress = new Set<number>()

/**
 * Signals that a specific user's profile is being viewed. If we don't have a local copy of that
 * user's profile data already, it will be retrieved from the server.
 */
export function viewUserProfile(userId: SbUserId, spec: RequestHandlingSpec): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    if (userProfileLoadsInProgress.has(userId)) {
      return
    }
    userProfileLoadsInProgress.add(userId)

    try {
      dispatch({
        type: '@profile/getUserProfile',
        payload: await fetchJson<GetUserProfileResponse>(apiUrl`users/${userId}/profile`, {
          signal: spec.signal,
        }),
      })
    } finally {
      userProfileLoadsInProgress.delete(userId)
    }
  })
}

const MAX_BATCH_INFO_REQUESTS = 20

const infoBatchRequester = new MicrotaskBatchRequester<SbUserId>(
  MAX_BATCH_INFO_REQUESTS,
  (dispatch, items) => {
    const params = items.map(u => urlPath`u=${u}`).join('&')
    const promise = fetchJson<GetBatchUserInfoResponse>(apiUrl`users/batch-info` + '?' + params)
    dispatch({
      type: '@profile/getBatchUserInfo',
      payload: promise,
      meta: {
        userIds: items,
      },
    })

    return promise
  },
  err => {
    logger.error('error while batch requesting user info: ' + (err as Error)?.stack ?? err)
  },
)

export function getBatchUserInfo(userId: SbUserId): ThunkAction {
  return (dispatch, getState) => {
    const {
      users: { byId },
    } = getState()

    if (!byId.has(userId)) {
      infoBatchRequester.request(dispatch, userId)
    }
  }
}
