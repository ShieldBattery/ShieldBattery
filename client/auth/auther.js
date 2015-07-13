import dispatcher from '../dispatcher'
import fetch from '../network/fetch'
import actions from '../actions'
import statuses from '../statuses'
import cuid from 'cuid'

const auther = {
  initFromPage() {
    // get the current user from the page body (if its not there, assume not logged in)
    if (!window._sbSession) {
      return
    }

    const { user, permissions } = window._sbSession
    window._sbSession = null
    dispatcher.dispatch({
      actionType: actions.AUTH_LOG_IN,
      actionStatus: statuses.SUCCESS,

      user,
      permissions,
    })
  },

  logIn(username, password, remember) {
    const reqId = cuid()
    dispatcher.dispatch({
      actionType: actions.AUTH_LOG_IN,
      actionStatus: statuses.BEGIN,
      reqId,
    })

    fetch('/api/1/sessions', {
      method: 'post',
      body: JSON.stringify({
        username,
        password,
        remember: !!remember
      })
    }).then(({ user, permissions }) => {
      dispatcher.dispatch({
        actionType: actions.AUTH_LOG_IN,
        actionStatus: statuses.SUCCESS,
        user,
        permissions,
        reqId,
      })
    }, err => {
      dispatcher.dispatch({
        actionType: actions.AUTH_LOG_IN,
        actionStatus: statuses.FAILURE,
        reqId,
        err,
      })
    })

    return reqId
  },

  logOut() {
    const reqId = cuid()
    dispatcher.dispatch({
      actionType: actions.AUTH_LOG_OUT,
      actionStatus: statuses.BEGIN,
      reqId,
    })

    fetch('/api/1/sessions', {
      method: 'delete'
    }).then(() => {
      dispatcher.dispatch({
        actionType: actions.AUTH_LOG_OUT,
        actionStatus: statuses.SUCCESS,
        reqId,
      })
    }, err => {
      dispatcher.dispatch({
        actionType: actions.AUTH_LOG_OUT,
        actionStatus: statuses.FAILURE,
        reqId,
        err,
      })
    })

    return reqId
  },

  signUp(username, email, password) {
    const reqId = cuid()
    dispatcher.dispatch({
      actionType: actions.AUTH_SIGN_UP,
      actionStatus: statuses.BEGIN,
      reqId,
    })

    fetch('/api/1/users', {
      method: 'post',
      body: JSON.stringify({ username, email, password })
    }).then(({ user, permissions }) => {
      dispatcher.dispatch({
        actionType: actions.AUTH_SIGN_UP,
        actionStatus: statuses.SUCCESS,
        user,
        permissions,
        reqId,
      })
    }, err => {
      dispatcher.dispatch({
        actionType: actions.AUTH_SIGN_UP,
        actionStatus: statuses.FAILURE,
        reqId,
        err,
      })
    })

    return reqId
  }
}

export default auther
