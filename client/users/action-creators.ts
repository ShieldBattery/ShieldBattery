import { getErrorStack } from '../../common/errors'
import { apiUrl, urlPath } from '../../common/urls'
import { SbPermissions } from '../../common/users/permissions'
import { SbUserId } from '../../common/users/sb-user-id'
import {
  AdminApplyRestrictionRequest,
  AdminApplyRestrictionResponse,
  AdminBanUserRequest,
  AdminBanUserResponse,
  AdminGetBansResponse,
  AdminGetPermissionsResponse,
  AdminGetRestrictionsResponse,
  AdminGetUserIpsResponse,
  AdminUpdatePermissionsRequest,
  GetBatchUserInfoResponse,
  GetUserProfileResponse,
  GetUserRankingHistoryResponse,
  SearchMatchHistoryResponse,
} from '../../common/users/user-network'
import { ThunkAction } from '../dispatch-registry'
import logger from '../logging/logger'
import { push, replace } from '../navigation/routing'
import { RequestHandlingSpec, abortableThunk } from '../network/abortable-thunk'
import { MicrotaskBatchRequester } from '../network/batch-requests'
import { encodeBodyAsParams, fetchJson } from '../network/fetch'
import { RequestCoalescer } from '../network/request-coalescer'
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
 * used when the client arrived on the page but the username doesn't match what we have stored for
 * their user ID.
 */
export function correctUsernameForProfile(
  userId: SbUserId,
  username: string,
  tab?: UserProfileSubPage,
) {
  replace(urlPath`/users/${userId}/${username}/${tab ?? ''}`)
}

const viewUserProfileRequestCoalescer = new RequestCoalescer<SbUserId>()

/**
 * Signals that a specific user's profile is being viewed. If we don't have a local copy of that
 * user's profile data already, it will be retrieved from the server.
 */
export function viewUserProfile(userId: SbUserId, spec: RequestHandlingSpec<void>): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    await viewUserProfileRequestCoalescer.makeRequest(
      userId,
      spec.signal,
      async (signal: AbortSignal) => {
        dispatch({
          type: '@users/getUserProfile',
          payload: await fetchJson<GetUserProfileResponse>(apiUrl`users/${userId}/profile`, {
            signal,
          }),
        })
      },
    )
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
    logger.error('error while batch requesting user info: ' + getErrorStack(err))
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

export function searchMatchHistory(
  userId: SbUserId,
  offset: number,
  spec: RequestHandlingSpec<SearchMatchHistoryResponse>,
): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    const result = await fetchJson<SearchMatchHistoryResponse>(
      apiUrl`users/${userId}/match-history?offset=${offset}`,
      {
        signal: spec.signal,
      },
    )

    dispatch({
      type: '@users/searchMatchHistory',
      payload: result,
      meta: { userId },
    })

    return result
  })
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

export function adminGetUserRestrictions(
  userId: SbUserId,
  spec: RequestHandlingSpec<AdminGetRestrictionsResponse>,
): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    const res = await fetchJson<AdminGetRestrictionsResponse>(
      apiUrl`admin/users/${userId}/restrictions`,
      {
        signal: spec.signal,
      },
    )
    dispatch({ type: '@users/loadUsers', payload: res.users })

    return res
  })
}

export function adminApplyRestriction(
  {
    userId,
    kind,
    endTime,
    reason,
    adminNotes,
  }: { userId: SbUserId } & AdminApplyRestrictionRequest,
  spec: RequestHandlingSpec<AdminApplyRestrictionResponse>,
): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    const res = await fetchJson<AdminApplyRestrictionResponse>(
      apiUrl`admin/users/${userId}/restrictions`,
      {
        method: 'POST',
        body: encodeBodyAsParams<AdminApplyRestrictionRequest>({
          kind,
          endTime,
          reason,
          adminNotes,
        }),
        signal: spec.signal,
      },
    )
    dispatch({ type: '@users/loadUsers', payload: res.users })

    return res
  })
}

export function getUserRankingHistory(
  userId: SbUserId,
  spec: RequestHandlingSpec<GetUserRankingHistoryResponse>,
): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    const result = await fetchJson<GetUserRankingHistoryResponse>(
      apiUrl`users/${userId}/ranking-history`,
      {
        signal: spec.signal,
      },
    )

    dispatch({
      type: '@users/getRankingHistory',
      payload: result,
      meta: { userId },
    })

    return result
  })
}
