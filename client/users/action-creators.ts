import { useSearch } from 'wouter'
import { getErrorStack } from '../../common/errors'
import { apiUrl, urlPath } from '../../common/urls'
import { SbPermissions } from '../../common/users/permissions'
import { SbUser } from '../../common/users/sb-user'
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
  AdminLiftRestrictionRequest,
  AdminLiftRestrictionResponse,
  AdminRemoveUserAvatarResponse,
  AdminSetStaffBadgeRequest,
  AdminSetStaffBadgeResponse,
  AdminUnbanUserRequest,
  AdminUnbanUserResponse,
  AdminUpdatePermissionsRequest,
  GetBatchUserInfoResponse,
  GetMatchHistoryQueryParams,
  GetMatchHistoryResponse,
  GetUserByNameResponse,
  GetUserProfileResponse,
  GetUserRankingHistoryResponse,
  SearchUsersResponse,
  UserErrorCode,
} from '../../common/users/user-network'
import { ReduxAction } from '../action-types'
import { DispatchFunction, ThunkAction } from '../dispatch-registry'
import { buildGameListSearchParams } from '../games/game-filter-url'
import logger from '../logging/logger'
import { push, replace } from '../navigation/routing'
import { abortableThunk, RequestHandlingSpec } from '../network/abortable-thunk'
import { MicrotaskBatchRequester } from '../network/batch-requests'
import { encodeBodyAsParams, fetchJson } from '../network/fetch'
import { isFetchError } from '../network/fetch-errors'
import { RequestCoalescer } from '../network/request-coalescer'
import { RootState } from '../root-reducer'
import { findUsersByAlias } from './user-aliases'
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

const EXPANDED_RANKS_PARAM = 'ranks'
const EXPANDED_RANKS_VALUE = 'expanded'

/**
 * Navigates to a specific user's profile with their full list of ranked modes expanded, rather
 * than just their most-active ones.
 */
export function navigateToUserProfileWithExpandedRanks(userId: SbUserId, username: string) {
  push({
    pathname: urlPath`/users/${userId}/${username}`,
    search: `${EXPANDED_RANKS_PARAM}=${EXPANDED_RANKS_VALUE}`,
  })
}

/**
 * Returns whether the current URL requests that the profile's ranked modes start expanded (i.e.
 * the user got here by asking to see more ranks than a preview surface showed).
 */
export function useIsExpandedRanksRequested(): boolean {
  const search = useSearch()
  return new URLSearchParams(search).get(EXPANDED_RANKS_PARAM) === EXPANDED_RANKS_VALUE
}

/**
 * Adjusts the current URL to reflect whether the profile's ranked modes are expanded, without
 * adding a history entry.
 */
export function updateExpandedRanksUrlParam(expanded: boolean) {
  const searchParams = new URLSearchParams(location.search)
  if (expanded) {
    searchParams.set(EXPANDED_RANKS_PARAM, EXPANDED_RANKS_VALUE)
  } else {
    searchParams.delete(EXPANDED_RANKS_PARAM)
  }
  replace({ pathname: location.pathname, search: searchParams.toString() })
}

/**
 * Corrects the URL for a specific user's profile if it is already being viewed. This is meant to be
 * used when the client arrived on the page but the username doesn't match what we have stored for
 * their user ID.
 */
/**
 * Rewrites the current profile URL so its username segment matches the user's current name. Any
 * path that follows the username (the tab, an admin sub-page) and the query string are kept, so a
 * rename never bounces the viewer to a different part of the profile.
 */
export function correctUsernameForProfile(userId: SbUserId, username: string) {
  const { pathname, search, hash } = window.location
  const segments = pathname.split('/')
  // A profile path splits as ['', 'users', id, username, ...rest]
  const rest = segments[1] === 'users' ? segments.slice(4).join('/') : ''
  const base = urlPath`/users/${userId}/${username}`
  replace({ pathname: rest ? `${base}/${rest}` : base, search, hash })
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

/**
 * Resolves a display name to the user carrying it, without regard to case. A user the client already
 * knows (a channel member, a friend, anyone it has seen) answers without a request; anyone else is
 * looked up on the server and merged into the store. Fails with a `FetchError` whose code is
 * `UserErrorCode.NotFound` when no user has the name.
 */
export function findUserByName(name: string, spec: RequestHandlingSpec<SbUser>): ThunkAction {
  return abortableThunk(spec, (dispatch, getState) =>
    lookUpUserByName(name, dispatch, getState, spec.signal),
  )
}

async function lookUpUserByName(
  name: string,
  dispatch: DispatchFunction<ReduxAction>,
  getState: () => RootState,
  signal?: AbortSignal,
): Promise<SbUser> {
  // The server resolves names without regard to case, so this scan has to as well: matching
  // exactly here would send a differently-cased name to the server and come back with the very
  // user that was already in hand.
  const lowered = name.toLowerCase()
  for (const user of getState().users.byId.values()) {
    if (user.name.toLowerCase() === lowered) {
      return user
    }
  }

  const { user } = await fetchJson<GetUserByNameResponse>(apiUrl`users/by-name/${name}`, {
    signal,
  })
  dispatch({ type: '@users/loadUsers', payload: [user] })

  return user
}

/**
 * A typed alias shared by several accounts, when no account has that exact original name.
 */
export class AmbiguousUserNameError extends Error {
  override name = 'AmbiguousUserNameError'

  constructor(
    readonly typedName: string,
    /**
     * Every account the local user gave `typedName` to as an alias.
     */
    readonly candidates: ReadonlyArray<Readonly<SbUser>>,
  ) {
    super(`"${typedName}" could mean any of ${candidates.length} users`)
  }
}

/**
 * Resolves a name the local user typed to the user they mean, like {@link findUserByName}, except
 * that the local user's aliases count too: names on screen are shown as aliases, so an alias is
 * what someone reading them will type. An alias may be shared by several accounts (e.g. to link
 * one player's accounts together) and may also be some other account's actual name, so a name can
 * mean more than one user. Exact original names take priority. A shared alias fails with an
 * {@link AmbiguousUserNameError} naming them all rather than guess.
 */
export function findUserByTypedName(name: string, spec: RequestHandlingSpec<SbUser>): ThunkAction {
  return abortableThunk(spec, (dispatch, getState) =>
    resolveTypedUserName(name, dispatch, getState, spec.signal),
  )
}

/** The work of {@link findUserByTypedName}, for thunks that resolve a typed name along the way. */
export async function resolveTypedUserName(
  name: string,
  dispatch: DispatchFunction<ReduxAction>,
  getState: () => RootState,
  signal?: AbortSignal,
): Promise<SbUser> {
  const aliasedUserIds = findUsersByAlias(name)
  if (!aliasedUserIds.length) {
    return await lookUpUserByName(name, dispatch, getState, signal)
  }

  let namedUser: SbUser | undefined
  try {
    namedUser = await lookUpUserByName(name, dispatch, getState, signal)
  } catch (err) {
    if (!isFetchError(err) || err.code !== UserErrorCode.NotFound) {
      throw err
    }
  }

  if (namedUser) {
    return namedUser
  }

  const candidates = await getUsersById(aliasedUserIds, dispatch, getState, signal)
  if (candidates.length > 1) {
    throw new AmbiguousUserNameError(name, candidates)
  }

  return candidates[0]
}

/** Returns the users with `userIds`, requesting any the client doesn't know in one batch. */
async function getUsersById(
  userIds: ReadonlyArray<SbUserId>,
  dispatch: DispatchFunction<ReduxAction>,
  getState: () => RootState,
  signal?: AbortSignal,
): Promise<SbUser[]> {
  const { byId } = getState().users
  const unknownIds = userIds.filter(id => !byId.has(id))
  const fetched = new Map<SbUserId, SbUser>()
  if (unknownIds.length) {
    const { userInfos } = await fetchJson<GetBatchUserInfoResponse>(
      apiUrl`users/batch-info` + '?' + unknownIds.map(id => urlPath`u=${id}`).join('&'),
      { signal },
    )
    dispatch({ type: '@users/loadUsers', payload: userInfos })
    for (const user of userInfos) {
      fetched.set(user.id, user)
    }
  }

  return userIds.map(id => {
    const user = byId.get(id) ?? fetched.get(id)
    if (!user) {
      throw new Error(`user ${id} not found`)
    }
    return user
  })
}

/**
 * Finds users whose name starts with `query`, without regard to case, merging them into the store.
 * Resolves to them shortest name first.
 */
export function searchUsers(query: string, spec: RequestHandlingSpec<SbUser[]>): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    const { users } = await fetchJson<SearchUsersResponse>(apiUrl`users/search?q=${query}`, {
      signal: spec.signal,
    })
    dispatch({ type: '@users/loadUsers', payload: users })

    return users
  })
}

export function getMatchHistory(
  userId: SbUserId,
  params: GetMatchHistoryQueryParams,
  spec: RequestHandlingSpec<GetMatchHistoryResponse>,
): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    const queryParams = buildGameListSearchParams(params)

    const result = await fetchJson<GetMatchHistoryResponse>(
      apiUrl`users/${userId}/match-history?${queryParams}`,
      {
        signal: spec.signal,
      },
    )

    dispatch({
      type: '@users/getMatchHistory',
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
  { userId, endTime, reason }: { userId: SbUserId; endTime: number; reason?: string },
  spec: RequestHandlingSpec<AdminBanUserResponse>,
): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    const res = await fetchJson<AdminBanUserResponse>(apiUrl`admin/users/${userId}/bans`, {
      method: 'POST',
      body: encodeBodyAsParams<AdminBanUserRequest>({
        endTime,
        reason,
      }),
      signal: spec.signal,
    })
    dispatch({ type: '@users/adminBanUser', payload: res })

    return res
  })
}

export function adminUnbanUser(
  { userId, reason }: { userId: SbUserId; reason?: string },
  spec: RequestHandlingSpec<AdminUnbanUserResponse>,
): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    const res = await fetchJson<AdminUnbanUserResponse>(apiUrl`admin/users/${userId}/unban`, {
      method: 'POST',
      body: encodeBodyAsParams<AdminUnbanUserRequest>({
        reason,
      }),
      signal: spec.signal,
    })
    dispatch({ type: '@users/adminUnbanUser', payload: res })

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

export function adminRemoveUserAvatar(
  userId: SbUserId,
  spec: RequestHandlingSpec<AdminRemoveUserAvatarResponse>,
): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    const res = await fetchJson<AdminRemoveUserAvatarResponse>(
      apiUrl`admin/users/${userId}/avatar`,
      {
        method: 'DELETE',
        signal: spec.signal,
      },
    )
    dispatch({ type: '@users/avatarCleared', payload: { userId } })

    return res
  })
}

export function adminSetStaffBadge(
  userId: SbUserId,
  staffBadge: boolean,
  spec: RequestHandlingSpec<AdminSetStaffBadgeResponse>,
): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    const res = await fetchJson<AdminSetStaffBadgeResponse>(
      apiUrl`admin/users/${userId}/staff-badge`,
      {
        method: 'POST',
        body: encodeBodyAsParams<AdminSetStaffBadgeRequest>({ staffBadge }),
        signal: spec.signal,
      },
    )
    dispatch({ type: '@users/loadUsers', payload: [res.user] })

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

export function adminLiftRestriction(
  { userId, kind, reason }: { userId: SbUserId } & AdminLiftRestrictionRequest,
  spec: RequestHandlingSpec<AdminLiftRestrictionResponse>,
): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    const res = await fetchJson<AdminLiftRestrictionResponse>(
      apiUrl`admin/users/${userId}/restrictions/lift`,
      {
        method: 'POST',
        body: encodeBodyAsParams<AdminLiftRestrictionRequest>({
          kind,
          reason,
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
