import dispatcher from '../dispatcher'
import actions from '../actions'
import statuses from '../statuses'
import ChangeEmitter from '../change-emitter'
import auther from './auther'

class AuthStore extends ChangeEmitter {
  constructor() {
    super()
    this.user = null
    this.permissions = null
    this.authChangeInProgress = false
    this.lastFailure = null
    this.id = dispatcher.register(action => this.dispatch(action))

    auther.initFromPage()
  }

  dispatch(action) {
    switch (action.actionType) {
      case actions.AUTH_LOG_IN:
        this.handleLogIn(action)
        break
      case actions.AUTH_LOG_OUT:
        this.handleLogOut(action)
        break
      case actions.AUTH_SIGN_UP:
        this.handleSignUp(action)
        break
      default:
        return
    }

    this.notifyAll()
  }

  setLastFailure(err = null, reqId = null) {
    if (!err && !reqId) {
      this.lastFailure = null
    } else {
      this.lastFailure = {
        err,
        reqId,
      }
    }
  }

  clearLastFailure() {
    this.setLastFailure()
  }

  handleLogIn(action) {
    switch (action.actionStatus) {
      case statuses.BEGIN:
        this.authChangeInProgress = true
        this.clearLastFailure()
        break
      case statuses.SUCCESS:
        this.authChangeInProgress = false
        this.user = action.user
        this.permissions = action.permissions
        break
      case statuses.FAILURE:
        this.authChangeInProgress = false
        this.setLastFailure(action.err, action.reqId)
        break
    }
  }

  handleLogOut(action) {
    switch (action.actionStatus) {
      case statuses.BEGIN:
        this.authChangeInProgress = true
        this.clearLastFailure()
        break
      case statuses.SUCCESS:
        this.authChangeInProgress = false
        this.user = null
        this.permissions = null
        break
      case statuses.FAILURE:
        this.authChangeInProgress = false
        this.setLastFailure(action.err, action.reqId)
        break
    }
  }

  handleSignUp(action) {
    switch (action.actionStatus) {
      case statuses.BEGIN:
        this.authChangeInProgress = true
        this.clearLastFailure()
        break
      case statuses.SUCCESS:
        this.authChangeInProgress = false
        this.user = action.user
        this.permissions = action.permissions
        break
      case statuses.FAILURE:
        this.authChangeInProgress = false
        this.setLastFailure(action.err, action.reqId)
        break
    }
  }

  get isLoggedIn() {
    return !!this.user
  }

  hasFailure(reqId) {
    return reqId && this.lastFailure && this.lastFailure.reqId === reqId
  }
}

module.exports = new AuthStore()
