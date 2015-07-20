import dispatcher from '../dispatcher'
import actions from '../actions'
import ChangeEmitter from '../change-emitter'

class ActiveUsersStore extends ChangeEmitter {
  constructor() {
    super()
    this.activeUsers = null
    this.id = dispatcher.register(action => this.dispatch(action))
  }

  dispatch(action) {
    if (action.actionType !== actions.SERVER_STATUS) return

    switch (action.actionStatus) {
      case statuses.BEGIN:
        this.activeUsers = null
        break
      case statuses.FAILURE:
        this.activeUsers = null
        break
      case statuses.SUCCESS:
        this.activeUsers = action.status.users
        break
    }

    this.notifyAll()
  }
}

export default new ActiveUsersStore()
