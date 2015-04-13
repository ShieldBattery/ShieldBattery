import dispatcher from '../dispatcher'
import actions from '../actions'
import statuses from '../statuses'
import siteSocket from '../network/site-socket'

class ServerStatusChecker {
  constructor() {
    this.interested = 0
    this._handleEvent = event => this._onEvent(event)

    siteSocket.on('connect', () => {
      if (this.interested >= 1) {
        this._subscribe()
      }
    })
  }

  registerInterest() {
    this.interested++
    if (this.interested == 1) {
      // this was our first interested client, subscribe to '/status' broadcasts
      this._subscribe()
    }
  }

  unregisterInterest() {
    this.interested--
    if (this.interested <= 0) {
      this._unsubscribe()
    }
  }

  _subscribe() {
    if (!siteSocket.connected) return

    dispatcher.dispatch({
      actionType: actions.SERVER_STATUS,
      actionStatus: statuses.BEGIN,
    })

    siteSocket.subscribe('/status', this._handleEvent, err => {
      dispatcher.dispatch({
        actionType: actions.SERVER_STATUS,
        actionStatus: statuses.FAILURE,
        err,
      })
    })
  }

  _unsubscribe() {
    if (!siteSocket.connected) return

    siteSocket.unsubscribe('/status', this._handleEvent)
  }

  _onEvent(event) {
    dispatcher.dispatch({
      actionType: actions.SERVER_STATUS,
      actionStatus: statuses.SUCCESS,
      status: event
    })
  }
}

export default new ServerStatusChecker()
