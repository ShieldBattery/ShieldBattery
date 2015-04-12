import dispatcher from '../dispatcher'
import xr from '../network/xr'
import actions from '../actions'
import statuses from '../statuses'
import cuid from 'cuid'

module.exports = {
  initFromPage() {
    // get the current user from the page body (if its not there, assume not logged in)
    if (!window._sbSession) {
      return
    }

    let { user, permissions } = window._sbSession
    window._sbSession = null
    dispatcher.dispatch({
      actionType: actions.AUTH_LOG_IN,
      actionStatus: statuses.SUCCESS,

      user,
      permissions,
    })
  },

  logIn(username, password, remember) {
    let reqId = cuid()
    dispatcher.dispatch({
      actionType: actions.AUTH_LOG_IN,
      actionStatus: statuses.BEGIN,
      reqId,
    })

    xr.post('/api/1/sessions', {
      username,
      password,
      remember: !!remember
    }).then(({ data: { user, permissions } }) => {
      dispatcher.dispatch({
        actionType: actions.AUTH_LOG_IN,
        actionStatus: statuses.SUCCESS,
        user,
        permissions,
        reqId,
      })
    }, data => {
      let err
      try {
        err = JSON.parse(data.response)
      } catch (e) {
        err = { error: 'Unknown error' }
      }
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
    let reqId = cuid()
    dispatcher.dispatch({
      actionType: actions.AUTH_LOG_OUT,
      actionStatus: statuses.BEGIN,
      reqId,
    })

    xr.del('/api/1/sessions')
      .then(() => {
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
}
