import { Map } from 'immutable'
import errors from 'http-errors'

class GameplayActivity {
  constructor() {
    this.userClients = new Map()
  }

  addClient(name, client) {
    this._ensureNotInGameplayActivity(name)
    this.userClients = this.userClients.set(name, client)
  }

  deleteClient(name) {
    this.userClients = this.userClients.delete(name)
  }

  getClientByName(name) {
    const client = this.userClients.get(name)
    if (!client) throw new errors.BadRequest('user not online')
    return client
  }

  _ensureNotInGameplayActivity(name) {
    if (this.userClients.has(name)) {
      throw new errors.Conflict('cannot enter multiple gameplay activities at once')
    }
  }
}

export default new GameplayActivity()
