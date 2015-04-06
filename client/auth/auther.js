let dispatcher = require('../dispatcher')
  , xr = require('../network/xr')
  , actions = require('../actions')
  , cuid = require('cuid')

module.exports = {
  initFromPage() {
    // get the current user from the page body (if its not there, assume not logged in)
    if (!window._sbSession) {
      return
    }

    let s = window._sbSession
    window._sbSession = null
    dispatcher.dispatch({
      actionType: actions.AUTH_LOG_IN_SUCCESS,
      user: s.user,
      permissions: s.permissions
    })
  },

  logIn(username, password, remember) {
    let reqId = cuid()
    dispatcher.dispatch({
      actionType: actions.AUTH_LOG_IN,
      reqId: reqId
    })

    xr.post('/api/1/sessions', {
      username: username,
      password: password,
      remember: !!remember
    }).then(({ data: { user, permissions } }) => {
      dispatcher.dispatch({
        actionType: actions.AUTH_LOG_IN_SUCCESS,
        user: user,
        permissions: permissions,
        reqId: reqId
      })
    }, err => {
      dispatcher.dispatch({
        actionType: actions.AUTH_LOG_IN_FAILURE,
        reqId: reqId
      })
    })

    return reqId
  },

  logOut() {
    // FIXME(tec27): this can fail, we should have the same action structure as login
    xr.del('/api/1/sessions')
      .then(() => {
        dispatcher.dispatch({
          actionType: actions.AUTH_LOGGED_OUT
        })
      })
  },
}
