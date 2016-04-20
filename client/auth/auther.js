import fetch from '../network/fetch'
import {
  AUTH_CHANGE_BEGIN,
  AUTH_LOG_IN,
  AUTH_LOG_OUT,
  AUTH_SIGN_UP,
} from '../actions'
import cuid from 'cuid'

function idRequest(type, fetcher) {
  const reqId = cuid()
  const thunk = dispatch => {
    dispatch({
      type: AUTH_CHANGE_BEGIN,
      payload: {
        reqId,
      }
    })

    const payload = fetcher()
    dispatch({ type, payload, meta: { reqId } })
  }

  return { id: reqId, action: thunk }
}

const auther = {
  logIn(username, password, remember) {
    return idRequest(AUTH_LOG_IN, () => fetch('/api/1/sessions', {
      method: 'post',
      body: JSON.stringify({
        username,
        password,
        remember: !!remember
      })
    }))
  },

  logOut() {
    return idRequest(AUTH_LOG_OUT, () => fetch('/api/1/sessions', {
      method: 'delete'
    }))
  },

  signUp(username, email, password, token) {
    const reqUrl = token ? '/api/1/users?token=' + token : '/api/1/users'
    return idRequest(AUTH_SIGN_UP, () => fetch(reqUrl, {
      method: 'post',
      body: JSON.stringify({ username, email, password })
    }))
  }
}

export default auther
