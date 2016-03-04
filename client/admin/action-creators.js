import fetch from '../network/fetch'
import {
  ADMIN_GET_INVITES_BEGIN,
  ADMIN_GET_INVITES,
  ADMIN_GET_PERMISSIONS_BEGIN,
  ADMIN_GET_PERMISSIONS,
  ADMIN_GET_PERMISSIONS_ERROR,
  ADMIN_ACCEPT_USER_BEGIN,
  ADMIN_ACCEPT_USER,
  ADMIN_SET_PERMISSIONS_BEGIN,
  ADMIN_SET_PERMISSIONS,
} from '../actions'

function shouldGetPermissions(state, username) {
  const lastUpdated = state.permissions.lastUpdated.get(username)

  if (!lastUpdated) {
    return true
  }

  if ((Date.now() - lastUpdated.time) > 60000) {
    return true
  }

  return false
}

export function getPermissionsIfNeeded(username) {
  return (dispatch, getState) => {
    if (shouldGetPermissions(getState(), username)) {
      return dispatch(getPermissions(username))
    }
    return null
  }
}

export function getPermissions(username) {
  return dispatch => {
    dispatch({
      type: ADMIN_GET_PERMISSIONS_BEGIN
    })

    fetch('/api/1/users/' + username, {
      method: 'get'
    }).then(value => {
      if (value.length) {
        dispatch({
          type: ADMIN_GET_PERMISSIONS,
          payload: fetch('/api/1/permissions/' + value[0].id, {
            method: 'get'
          }),
          meta: { username }
        })
      } else {
        dispatch({
          type: ADMIN_GET_PERMISSIONS_ERROR
        })
      }
    })
  }
}

export function setPermissions(username, permissions) {
  return dispatch => {
    dispatch({
      type: ADMIN_SET_PERMISSIONS_BEGIN
    })

    fetch('/api/1/users/' + username, {
      method: 'get'
    }).then(value => {
      if (value.length) {
        dispatch({
          type: ADMIN_SET_PERMISSIONS,
          payload: fetch('/api/1/permissions/' + value[0].id, {
            method: 'post',
            body: JSON.stringify(permissions)
          })
        })
      }
    })
  }
}

export function getInvites(inviteeType) {
  return dispatch => {
    dispatch({
      type: ADMIN_GET_INVITES_BEGIN
    })

    let reqUrl = '/api/1/invites'
    if (inviteeType === 'accepted') {
      reqUrl += '?accepted=true'
    } else if (inviteeType === 'unaccepted') {
      reqUrl += '?accepted=false'
    }

    dispatch({
      type: ADMIN_GET_INVITES,
      payload: fetch(reqUrl, {
        method: 'get'
      })
    })
  }
}

export function acceptUser(email) {
  return dispatch => {
    dispatch({
      type: ADMIN_ACCEPT_USER_BEGIN
    })

    dispatch({
      type: ADMIN_ACCEPT_USER,
      payload: fetch('/api/1/invites/' + email, {
        method: 'put',
        body: JSON.stringify({
          isAccepted: true
        })
      })
    })
  }
}
