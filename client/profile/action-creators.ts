import { GetUserProfilePayload } from '../../common/users/user-info'
import { ReduxAction } from '../action-types'
import { DispatchFunction, ThunkAction } from '../dispatch-registry'
import { push, replace } from '../navigation/routing'
import fetch from '../network/fetch'
import { apiUrl, urlPath } from '../network/urls'
import { RootState } from '../root-reducer'
import { UserProfileSubPage } from './user-profile-sub-page'

/**
 * Navigates to a specific user's profile (and optionally, a specific tab within that).
 */
export function navigateToUserProfile(userId: number, username: string, tab?: UserProfileSubPage) {
  push(urlPath`/users/${userId}/${username}/${tab ?? ''}`)
}

/**
 * Corrects the URL for a specific user's profile if it is already being viewed. This is meant to be
 * used when the client arrived on the page bu the username doesn't match what we have stored for
 * their user ID.
 */
export function correctUsernameForProfile(
  userId: number,
  username: string,
  tab?: UserProfileSubPage,
) {
  replace(urlPath`/users/${userId}/${username}/${tab ?? ''}`)
}

export interface RequestHandlingSpec {
  signal?: AbortSignal
  onSuccess: () => void
  onError: (err: Error) => void
}

function abortableThunk<T extends ReduxAction>(
  { signal, onSuccess, onError }: RequestHandlingSpec,
  thunkFn: (dispatch: DispatchFunction<T>, getState: () => RootState) => Promise<void>,
): ThunkAction<T> {
  return (dispatch, getState) => {
    thunkFn(dispatch, getState)
      .then(() => {
        if (signal?.aborted) {
          return
        }

        onSuccess()
      })
      .catch((err: Error) => {
        if (signal?.aborted || (signal && err.name === 'AbortError')) {
          return
        }

        onError(err)
      })
  }
}

const userProfileLoadsInProgress = new Set<number>()

/**
 * Signals that a specific user's profile is being viewed. If we don't have a local copy of that
 * user's profile data already, it will be retrieved from the server.
 */
export function viewUserProfile(userId: number, spec: RequestHandlingSpec): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    if (userProfileLoadsInProgress.has(userId)) {
      return
    }
    userProfileLoadsInProgress.add(userId)

    try {
      dispatch({
        type: '@profile/getUserProfile',
        payload: await fetch<GetUserProfilePayload>(apiUrl`users/${userId}/profile`, {
          signal: spec.signal,
        }),
      })
    } finally {
      userProfileLoadsInProgress.delete(userId)
    }
  })
}
