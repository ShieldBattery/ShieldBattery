import fetch from '../network/fetch'
import {
  AUTH_CHANGE_BEGIN,
  AUTH_LOG_IN,
  AUTH_LOG_OUT,
  AUTH_RESET_PASSWORD,
  AUTH_RETRIEVE_USERNAME,
  AUTH_SIGN_UP,
  AUTH_START_PASSWORD_RESET,
  AUTH_UPDATE,
} from '../actions'
import cuid from 'cuid'

function idRequest(type, fetcher) {
  const reqId = cuid()
  let thunk
  const promise = new Promise((resolve, reject) => {
    thunk = dispatch => {
      dispatch({
        type: AUTH_CHANGE_BEGIN,
        payload: {
          reqId,
        }
      })

      const payload = fetcher()
      dispatch({ type, payload, meta: { reqId } })
      payload.then(resolve, reject)
    }
  })

  return { id: reqId, action: thunk, promise }
}

export function logIn(username, password, remember) {
  return idRequest(AUTH_LOG_IN, () => fetch('/api/1/sessions', {
    method: 'post',
    body: JSON.stringify({
      username,
      password,
      remember: !!remember
    })
  }))
}

export function logOut() {
  return idRequest(AUTH_LOG_OUT, () => fetch('/api/1/sessions', {
    method: 'delete'
  }))
}

export function signUp(username, email, password) {
  const reqUrl = '/api/1/users'
  return idRequest(AUTH_SIGN_UP, () => fetch(reqUrl, {
    method: 'post',
    body: JSON.stringify({ username, email, password })
  }))
}

export function getCurrentSession() {
  return idRequest(AUTH_UPDATE, () => fetch('/api/1/sessions', {
    method: 'get'
  }))
}

export function retrieveUsername(email) {
  return idRequest(AUTH_RETRIEVE_USERNAME, () => fetch('/api/1/recovery/user', {
    method: 'post',
    body: JSON.stringify({
      email,
    })
  }))
}

export function startPasswordReset(username, email) {
  return idRequest(AUTH_START_PASSWORD_RESET, () => fetch('/api/1/recovery/password', {
    method: 'post',
    body: JSON.stringify({
      username,
      email,
    })
  }))
}

export function resetPassword(username, code, password) {
  const url = '/api/1/users/' + encodeURIComponent(username) + '/password?code=' +
      encodeURIComponent(code)
  return idRequest(AUTH_RESET_PASSWORD, () => fetch(url, {
    method: 'post',
    body: JSON.stringify({
      password
    })
  }))
}
