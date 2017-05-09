import { Map } from 'immutable'

export class GameplayActivityRegistry {
  constructor() {
    this.userClients = new Map()
  }

  // Attempts to register a client as owning the active gameplay activity for a user.
  // Returns true if no other client was registered for the user, false otherwise.
  registerActiveClient(name, client) {
    if (this.userClients.has(name)) {
      return false
    }

    this.userClients = this.userClients.set(name, client)
    return true
  }

  // Unregisters the active client for a user.
  // Returns true if a client was registered for that user, false otherwise.
  unregisterClientForUser(name) {
    const updated = this.userClients.delete(name)
    const result = updated !== this.userClients
    this.userClients = updated
    return result
  }

  // Returns the currently active client for a user. If no client was active, returns null.
  getClientForUser(name) {
    return this.userClients.get(name)
  }
}

export default new GameplayActivityRegistry()
