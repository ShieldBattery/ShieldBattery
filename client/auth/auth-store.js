let dispatcher = require('../dispatcher')
  , actions = require('../actions')
  , ChangeEmitter = require('../change-emitter')
  , auther = require('./auther')

class AuthStore extends ChangeEmitter {
  constructor() {
    super()
    this.user = null
    this.permissions = null
    this.loginInProgress = false
    this.id = dispatcher.register(action => this.dispatch(action))
    auther.initFromPage()
  }

  dispatch(action) {
    switch (action.actionType) {
      case actions.AUTH_LOG_IN:
        this.loginInProgress = true
        break
      case actions.AUTH_LOG_IN_SUCCESS:
        this.loginInProgress = false
        this.user = action.user
        this.permissions = action.permissions
        break
      case actions.AUTH_LOG_IN_FAILURE:
        this.loginInProgress = false
        break
      case actions.AUTH_LOGGED_OUT:
        this.user = null
        this.permissions = null
        break
      default:
        return
    }

    this.notifyAll()
  }

  get isLoggedIn() {
    return !!this.user
  }
}

module.exports = new AuthStore()
