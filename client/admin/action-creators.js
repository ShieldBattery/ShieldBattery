import fetch from '../network/fetch'
import { openSnackbar } from '../snackbars/action-creators'
import {
  ADMIN_BAN_USER_BEGIN,
  ADMIN_BAN_USER,
  ADMIN_GET_BAN_HISTORY_BEGIN,
  ADMIN_GET_BAN_HISTORY,
  ADMIN_GET_INVITES_BEGIN,
  ADMIN_GET_INVITES,
  ADMIN_GET_MAP_POOL_HISTORY_BEGIN,
  ADMIN_GET_MAP_POOL_HISTORY,
  ADMIN_GET_PERMISSIONS_BEGIN,
  ADMIN_GET_PERMISSIONS,
  ADMIN_ACCEPT_USER_BEGIN,
  ADMIN_ACCEPT_USER,
  ADMIN_CREATE_MAP_POOL_BEGIN,
  ADMIN_CREATE_MAP_POOL,
  ADMIN_DELETE_MAP_POOL_BEGIN,
  ADMIN_DELETE_MAP_POOL,
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

export function getInvites(inviteeType, limit, pageNumber) {
  return dispatch => {
    dispatch({
      type: ADMIN_GET_INVITES_BEGIN,
      meta: { inviteeType },
    })

    let reqUrl = `/api/1/invites?limit=${limit}&page=${pageNumber}`
    if (inviteeType === 'accepted') {
      reqUrl += '&accepted=true'
    } else if (inviteeType === 'unaccepted') {
      reqUrl += '&accepted=false'
    }

    dispatch({
      type: ADMIN_GET_INVITES,
      payload: fetch(reqUrl),
      meta: { inviteeType },
    })
  }
}

export function acceptUser(email) {
  return dispatch => {
    dispatch({
      type: ADMIN_ACCEPT_USER_BEGIN,
      meta: { email },
    })

    dispatch({
      type: ADMIN_ACCEPT_USER,
      payload: fetch('/api/1/invites/' + encodeURIComponent(email), {
        method: 'put',
        body: JSON.stringify({ isAccepted: true }),
      }),
      meta: { email },
    })
  }
}

export function getMapPoolHistory(type) {
  return dispatch => {
    dispatch({
      type: ADMIN_GET_MAP_POOL_HISTORY_BEGIN,
      payload: { type },
    })
    dispatch({
      type: ADMIN_GET_MAP_POOL_HISTORY,
      payload: fetch('/api/1/matchmakingMapPools/' + encodeURIComponent(type)),
      meta: { type },
    })
  }
}

export function createMapPool(type, maps, startDate = Date.now()) {
  return dispatch => {
    dispatch({
      type: ADMIN_CREATE_MAP_POOL_BEGIN,
      meta: { type, maps, startDate },
    })
    const params = { method: 'post', body: JSON.stringify({ maps, startDate }) }
    dispatch({
      type: ADMIN_CREATE_MAP_POOL,
      payload: fetch(
        '/api/1/matchmakingMapPools/' + encodeURIComponent(type),
        params,
      ).then(mapPool => {
        dispatch(openSnackbar({ message: 'New map pool created!' }))
        return mapPool
      }),
      meta: { type, maps, startDate },
    })
  }
}

export function deleteMapPool(type, id) {
  return dispatch => {
    dispatch({
      type: ADMIN_DELETE_MAP_POOL_BEGIN,
      meta: { type, id },
    })
    dispatch({
      type: ADMIN_DELETE_MAP_POOL,
      payload: fetch('/api/1/matchmakingMapPools/' + encodeURIComponent(id), {
        method: 'delete',
      }).then(() => dispatch(openSnackbar({ message: 'Map pool deleted!' }))),
      meta: { type, id },
    })
  }
}
