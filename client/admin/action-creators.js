import fetch from '../network/fetch'
import { openSnackbar } from '../snackbars/action-creators'
import {
  ADMIN_BAN_USER_BEGIN,
  ADMIN_BAN_USER,
  ADMIN_GET_BAN_HISTORY_BEGIN,
  ADMIN_GET_BAN_HISTORY,
  ADMIN_GET_PERMISSIONS_BEGIN,
  ADMIN_GET_PERMISSIONS,
  ADMIN_MAP_POOL_CLEAR_SEARCH,
  ADMIN_MAP_POOL_CREATE_BEGIN,
  ADMIN_MAP_POOL_CREATE,
  ADMIN_MAP_POOL_DELETE_BEGIN,
  ADMIN_MAP_POOL_DELETE,
  ADMIN_MAP_POOL_GET_HISTORY_BEGIN,
  ADMIN_MAP_POOL_GET_HISTORY,
  ADMIN_MAP_POOL_SEARCH_MAPS_BEGIN,
  ADMIN_MAP_POOL_SEARCH_MAPS,
  ADMIN_MATCHMAKING_TIMES_ADD_BEGIN,
  ADMIN_MATCHMAKING_TIMES_ADD,
  ADMIN_MATCHMAKING_TIMES_DELETE_BEGIN,
  ADMIN_MATCHMAKING_TIMES_DELETE,
  ADMIN_MATCHMAKING_TIMES_GET_HISTORY_BEGIN,
  ADMIN_MATCHMAKING_TIMES_GET_HISTORY,
  ADMIN_MATCHMAKING_TIMES_GET_FUTURE_BEGIN,
  ADMIN_MATCHMAKING_TIMES_GET_FUTURE,
  ADMIN_MATCHMAKING_TIMES_GET_PAST_BEGIN,
  ADMIN_MATCHMAKING_TIMES_GET_PAST,
  ADMIN_SET_PERMISSIONS_BEGIN,
  ADMIN_SET_PERMISSIONS,
} from '../actions'

const USER_PROFILE_STALE_TIME = 60 * 1000
function shouldGetUserProfile(state, username) {
  // TODO(tec27): Refactor all of this to flow into a single reducer and API request that stores the
  // time, instead of storing a time in each single reducer and just expecting that they have the
  // same structure.
  const { users } = state
  if (!users.has(username)) {
    return true
  }
  const user = users.get(username)
  return !user.isRequesting && Date.now() - user.lastUpdated > USER_PROFILE_STALE_TIME
}

function fetchUserId(username) {
  // TODO(tec27): this can be cached
  return fetch('/api/1/users/' + encodeURIComponent(username)).then(value => {
    if (!value.length) throw new Error('No user found with that name')
    else return value[0].id
  })
}

function getPermissions(username) {
  return dispatch => {
    dispatch({
      type: ADMIN_GET_PERMISSIONS_BEGIN,
      payload: { username },
    })
    dispatch({
      type: ADMIN_GET_PERMISSIONS,
      payload: fetchUserId(username).then(id =>
        fetch('/api/1/permissions/' + encodeURIComponent(id)),
      ),
      meta: { username },
    })
  }
}

export function getPermissionsIfNeeded(username) {
  return (dispatch, getState) => {
    if (shouldGetUserProfile(getState().permissions, username)) {
      dispatch(getPermissions(username))
    }
  }
}

export function setPermissions(username, permissions) {
  return dispatch => {
    dispatch({
      type: ADMIN_SET_PERMISSIONS_BEGIN,
      meta: { username, permissions },
    })
    const params = { method: 'post', body: JSON.stringify(permissions) }
    dispatch({
      type: ADMIN_SET_PERMISSIONS,
      payload: fetchUserId(username)
        .then(id => fetch('/api/1/permissions/' + encodeURIComponent(id), params))
        .then(permissions => {
          dispatch(openSnackbar({ message: 'Saved!' }))
          return permissions
        }),
      meta: { username, permissions },
    })
  }
}

function getBanHistory(username) {
  return dispatch => {
    dispatch({
      type: ADMIN_GET_BAN_HISTORY_BEGIN,
      payload: { username },
    })
    dispatch({
      type: ADMIN_GET_BAN_HISTORY,
      payload: fetchUserId(username).then(id => fetch('/api/1/bans/' + encodeURIComponent(id))),
      meta: { username },
    })
  }
}

export function getBanHistoryIfNeeded(username) {
  return (dispatch, getState) => {
    if (shouldGetUserProfile(getState().bans, username)) {
      dispatch(getBanHistory(username))
    }
  }
}

export function banUser(username, length, reason) {
  return dispatch => {
    dispatch({
      type: ADMIN_BAN_USER_BEGIN,
      meta: { username, length, reason },
    })
    const params = { method: 'post', body: JSON.stringify({ banLengthHours: length, reason }) }
    dispatch({
      type: ADMIN_BAN_USER,
      payload: fetchUserId(username)
        .then(id => fetch('/api/1/bans/' + encodeURIComponent(id), params))
        .then(bans => {
          dispatch(openSnackbar({ message: 'Banned!' }))
          return bans
        }),
      meta: { username, length, reason },
    })
  }
}

export function searchMaps(visibility, limit, page, query = '') {
  return dispatch => {
    dispatch({ type: ADMIN_MAP_POOL_SEARCH_MAPS_BEGIN })

    const reqUrl = `/api/1/maps?visibility=${visibility}&q=${query}&limit=${limit}&page=${page}`
    dispatch({ type: ADMIN_MAP_POOL_SEARCH_MAPS, payload: fetch(reqUrl) })
  }
}

export function clearSearch() {
  return {
    type: ADMIN_MAP_POOL_CLEAR_SEARCH,
  }
}

// TODO(2Pac): This can be cached
export function getMapPoolHistory(type, limit, page) {
  return dispatch => {
    dispatch({
      type: ADMIN_MAP_POOL_GET_HISTORY_BEGIN,
      meta: { type },
    })
    dispatch({
      type: ADMIN_MAP_POOL_GET_HISTORY,
      payload: fetch(
        `/api/1/matchmakingMapPools/${encodeURIComponent(type)}?limit=${limit}&page=${page}`,
      ),
      meta: { type },
    })
  }
}

export function createMapPool(type, maps, startDate = Date.now()) {
  return dispatch => {
    dispatch({
      type: ADMIN_MAP_POOL_CREATE_BEGIN,
      meta: { type },
    })

    const params = { method: 'post', body: JSON.stringify({ maps, startDate }) }
    dispatch({
      type: ADMIN_MAP_POOL_CREATE,
      payload: fetch(`/api/1/matchmakingMapPools/${encodeURIComponent(type)}`, params).then(
        mapPool => {
          dispatch(openSnackbar({ message: 'New map pool created' }))
          return mapPool
        },
      ),
      meta: { type, maps, startDate },
    })
  }
}

export function deleteMapPool(type, id) {
  return dispatch => {
    dispatch({
      type: ADMIN_MAP_POOL_DELETE_BEGIN,
      meta: { type, id },
    })
    dispatch({
      type: ADMIN_MAP_POOL_DELETE,
      payload: fetch(`/api/1/matchmakingMapPools/${encodeURIComponent(id)}`, {
        method: 'delete',
      }).then(() => dispatch(openSnackbar({ message: 'Map pool deleted' }))),
      meta: { type, id },
    })
  }
}

// TODO(2Pac): This can be cached
export function getMatchmakingTimesHistory(type) {
  return dispatch => {
    dispatch({
      type: ADMIN_MATCHMAKING_TIMES_GET_HISTORY_BEGIN,
      meta: { type },
    })
    dispatch({
      type: ADMIN_MATCHMAKING_TIMES_GET_HISTORY,
      payload: fetch(`/api/1/matchmakingTimes/${encodeURIComponent(type)}`),
      meta: { type },
    })
  }
}

export function getMatchmakingTimesFuture(type, limit, page) {
  return dispatch => {
    dispatch({
      type: ADMIN_MATCHMAKING_TIMES_GET_FUTURE_BEGIN,
      meta: { type },
    })
    dispatch({
      type: ADMIN_MATCHMAKING_TIMES_GET_FUTURE,
      payload: fetch(
        `/api/1/matchmakingTimes/${encodeURIComponent(type)}/future?limit=${limit}&page=${page}`,
      ),
      meta: { type },
    })
  }
}

export function getMatchmakingTimesPast(type, limit, page) {
  return dispatch => {
    dispatch({
      type: ADMIN_MATCHMAKING_TIMES_GET_PAST_BEGIN,
      meta: { type },
    })
    dispatch({
      type: ADMIN_MATCHMAKING_TIMES_GET_PAST,
      payload: fetch(
        `/api/1/matchmakingTimes/${encodeURIComponent(type)}/past?limit=${limit}&page=${page}`,
      ),
      meta: { type },
    })
  }
}

export function addMatchmakingTime(type, startDate = Date.now(), enabled = false) {
  return dispatch => {
    dispatch({
      type: ADMIN_MATCHMAKING_TIMES_ADD_BEGIN,
      meta: { type },
    })

    const params = { method: 'post', body: JSON.stringify({ startDate, enabled }) }
    dispatch({
      type: ADMIN_MATCHMAKING_TIMES_ADD,
      payload: fetch(`/api/1/matchmakingTimes/${encodeURIComponent(type)}`, params).then(
        matchmakingTime => {
          dispatch(openSnackbar({ message: 'New matchmaking time created' }))
          return matchmakingTime
        },
      ),
      meta: { type },
    })
  }
}

export function deleteMatchmakingTime(type, id) {
  return dispatch => {
    dispatch({
      type: ADMIN_MATCHMAKING_TIMES_DELETE_BEGIN,
      meta: { type, id },
    })
    dispatch({
      type: ADMIN_MATCHMAKING_TIMES_DELETE,
      payload: fetch(`/api/1/matchmakingTimes/${encodeURIComponent(id)}`, {
        method: 'delete',
      }).then(() => dispatch(openSnackbar({ message: 'Matchmaking time deleted' }))),
      meta: { type, id },
    })
  }
}
