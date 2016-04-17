import fetch from '../network/fetch'
import { openSnackbar } from '../snackbars/action-creators'
import {
  ADMIN_GET_INVITES_BEGIN,
  ADMIN_GET_INVITES,
  ADMIN_GET_PERMISSIONS_BEGIN,
  ADMIN_GET_PERMISSIONS,
  ADMIN_ACCEPT_USER_BEGIN,
  ADMIN_ACCEPT_USER,
  ADMIN_SET_PERMISSIONS_BEGIN,
  ADMIN_SET_PERMISSIONS,
} from '../actions'

const PERMISSIONS_STALE_TIME = 60 * 1000
function shouldGetPermissions(state, username) {
  const { permissions: { users } } = state
  if (!users.has(username)) {
    return true
  }
  const user = users.get(username)
  return !user.isRequesting && (Date.now() - user.lastUpdated) > PERMISSIONS_STALE_TIME
}

function fetchUserId(username) {
  return (fetch('/api/1/users/' + encodeURIComponent(username))
    .then(value => {
      if (!value.length) throw new Error('No user found with that name')
      else return value[0].id
    }))
}

function getPermissions(username) {
  return dispatch => {
    dispatch({
      type: ADMIN_GET_PERMISSIONS_BEGIN,
      payload: { username }
    })
    dispatch({
      type: ADMIN_GET_PERMISSIONS,
      payload: fetchUserId(username).then(id => fetch('/api/1/permissions/' + id)),
      meta: { username }
    })
  }
}

export function getPermissionsIfNeeded(username) {
  return (dispatch, getState) => {
    if (shouldGetPermissions(getState(), username)) {
      dispatch(getPermissions(username))
    }
  }
}

export function setPermissions(username, permissions) {
  return dispatch => {
    dispatch({
      type: ADMIN_SET_PERMISSIONS_BEGIN,
      meta: { username, permissions }
    })
    const params = { method: 'post', body: JSON.stringify(permissions) }
    dispatch({
      type: ADMIN_SET_PERMISSIONS,
      payload: fetchUserId(username)
          .then(id => fetch('/api/1/permissions/' + id, params))
          .then(permissions => {
            dispatch(openSnackbar({ message: 'Saved!' }))
            return permissions
          }),
      meta: { username, permissions },
    })
  }
}

export function getInvites(inviteeType) {
  return dispatch => {
    dispatch({
      type: ADMIN_GET_INVITES_BEGIN,
      meta: { inviteeType },
    })

    let reqUrl = '/api/1/invites'
    if (inviteeType === 'accepted') {
      reqUrl += '?accepted=true'
    } else if (inviteeType === 'unaccepted') {
      reqUrl += '?accepted=false'
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
      meta: { email }
    })

    dispatch({
      type: ADMIN_ACCEPT_USER,
      payload: fetch('/api/1/invites/' + encodeURIComponent(email), {
        method: 'put',
        body: JSON.stringify({ isAccepted: true })
      }),
      meta: { email }
    })
  }
}
