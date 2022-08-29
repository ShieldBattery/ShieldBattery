import { apiUrl, urlPath } from '../../common/urls'
import { SbPermissions } from '../../common/users/permissions'
import { GetRelationshipsResponse } from '../../common/users/relationships'
import {
  AdminBanUserRequest,
  AdminBanUserResponse,
  AdminGetBansResponse,
  AdminGetPermissionsResponse,
  AdminGetUserIpsResponse,
  AdminUpdatePermissionsRequest,
  GetBatchUserInfoResponse,
  GetUserProfileResponse,
  SbUserId,
} from '../../common/users/sb-user'
import { ThunkAction } from '../dispatch-registry'
import logger from '../logging/logger'
import { push, replace } from '../navigation/routing'
import { abortableThunk, RequestHandlingSpec } from '../network/abortable-thunk'
import { MicrotaskBatchRequester } from '../network/batch-requests'
import { encodeBodyAsParams, fetchJson } from '../network/fetch'
import { UserProfileSubPage } from './user-profile-sub-page'

/**
 * Navigates to a specific user's profile (and optionally, a specific tab within that).
 */
export function navigateToUserProfile(
  userId: SbUserId,
  username: string,
  tab?: UserProfileSubPage,
  transitionFn = push,
) {
  transitionFn(urlPath`/users/${userId}/${username}/${tab ?? ''}`)
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

const userProfileLoadsInProgress = new Set<SbUserId>()

/**
 * Signals that a specific user's profile is being viewed. If we don't have a local copy of that
 * user's profile data already, it will be retrieved from the server.
 */
export function viewUserProfile(userId: SbUserId, spec: RequestHandlingSpec<void>): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    if (userProfileLoadsInProgress.has(userId)) {
      return
    }
    userProfileLoadsInProgress.add(userId)

    try {
      dispatch({
        type: '@users/getUserProfile',
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
      type: '@users/getBatchUserInfo',
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

export function adminGetUserPermissions(
  userId: SbUserId,
  spec: RequestHandlingSpec<AdminGetPermissionsResponse>,
): ThunkAction {
  return abortableThunk(spec, async () => {
    return await fetchJson<AdminGetPermissionsResponse>(apiUrl`admin/users/${userId}/permissions`, {
      signal: spec.signal,
    })
  })
}

export function adminUpdateUserPermissions(
  userId: SbUserId,
  permissions: SbPermissions,
  spec: RequestHandlingSpec<void>,
): ThunkAction {
  return abortableThunk(spec, async () => {
    const body: AdminUpdatePermissionsRequest = {
      permissions,
    }
    return await fetchJson<void>(apiUrl`admin/users/${userId}/permissions`, {
      method: 'POST',
      body: JSON.stringify(body),
      signal: spec.signal,
    })
  })
}

export function adminGetUserBanHistory(
  userId: SbUserId,
  spec: RequestHandlingSpec<AdminGetBansResponse>,
): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    const res = await fetchJson<AdminGetBansResponse>(apiUrl`admin/users/${userId}/bans`, {
      signal: spec.signal,
    })
    dispatch({ type: '@users/adminGetUserBanHistory', payload: res })

    return res
  })
}

export function adminBanUser(
  { userId, banLengthHours, reason }: { userId: SbUserId; banLengthHours: number; reason?: string },
  spec: RequestHandlingSpec<AdminBanUserResponse>,
): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    const res = await fetchJson<AdminBanUserResponse>(apiUrl`admin/users/${userId}/bans`, {
      method: 'POST',
      body: encodeBodyAsParams<AdminBanUserRequest>({
        banLengthHours,
        reason,
      }),
      signal: spec.signal,
    })
    dispatch({ type: '@users/adminBanUser', payload: res })

    return res
  })
}

export function adminGetUserIps(
  userId: SbUserId,
  spec: RequestHandlingSpec<AdminGetUserIpsResponse>,
): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    const res = await fetchJson<AdminGetUserIpsResponse>(apiUrl`admin/users/${userId}/ips`, {
      signal: spec.signal,
    })
    dispatch({ type: '@users/adminGetUserIps', payload: res })

    return res
  })
}

export function getRelationshipsIfNeeded(spec: RequestHandlingSpec): ThunkAction {
  return abortableThunk(spec, async (dispatch, getState) => {
    const {
      auth: { user },
      relationships,
    } = getState()
    if (relationships.loaded) {
      return
    }

    const result = await fetchJson<GetRelationshipsResponse>(
      apiUrl`users/${user.id}/relationships`,
      { signal: spec.signal },
    )
    dispatch({ type: '@users/getRelationships', payload: result })
  })
}

export function sendFriendRequest(toId: SbUserId, spec: RequestHandlingSpec): ThunkAction {
  return abortableThunk(spec, async () => {
    await fetchJson<void>(apiUrl`users/${toId}/relationships/friend-requests`, {
      method: 'POST',
      signal: spec.signal,
    })
  })
}

export function removeFriendRequest(toId: SbUserId, spec: RequestHandlingSpec): ThunkAction {
  return abortableThunk(spec, async (_, getState) => {
    const {
      auth: { user },
    } = getState()

    await fetchJson<void>(apiUrl`users/${toId}/relationships/friend-requests/${user.id}`, {
      method: 'DELETE',
      signal: spec.signal,
    })
  })
}

export function acceptFriendRequest(fromId: SbUserId, spec: RequestHandlingSpec): ThunkAction {
  return abortableThunk(spec, async (_, getState) => {
    const {
      auth: { user },
    } = getState()

    await fetchJson<void>(apiUrl`users/${user.id}/relationships/friends/${fromId}`, {
      method: 'POST',
      signal: spec.signal,
    })
  })
}

export function declineFriendRequest(fromId: SbUserId, spec: RequestHandlingSpec): ThunkAction {
  return abortableThunk(spec, async (_, getState) => {
    const {
      auth: { user },
    } = getState()

    await fetchJson<void>(apiUrl`users/${user.id}/relationships/friend-requests/${fromId}`, {
      method: 'DELETE',
      signal: spec.signal,
    })
  })
}

export function removeFriend(targetId: SbUserId, spec: RequestHandlingSpec): ThunkAction {
  return abortableThunk(spec, async (_, getState) => {
    const {
      auth: { user },
    } = getState()

    await fetchJson<void>(apiUrl`users/${user.id}/relationships/friends/${targetId}`, {
      method: 'DELETE',
      signal: spec.signal,
    })
  })
}

export function blockUser(targetId: SbUserId, spec: RequestHandlingSpec): ThunkAction {
  return abortableThunk(spec, async (_, getState) => {
    const {
      auth: { user },
    } = getState()

    await fetchJson<void>(apiUrl`users/${user.id}/relationships/blocks/${targetId}`, {
      method: 'POST',
      signal: spec.signal,
    })
  })
}

export function unblockUser(targetId: SbUserId, spec: RequestHandlingSpec): ThunkAction {
  return abortableThunk(spec, async (_, getState) => {
    const {
      auth: { user },
    } = getState()

    await fetchJson<void>(apiUrl`users/${user.id}/relationships/blocks/${targetId}`, {
      method: 'DELETE',
      signal: spec.signal,
    })
  })
}
