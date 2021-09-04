import { Map } from 'immutable'
import { SbUserId } from '../../../common/users/user-info'
import { ClientSocketsGroup } from '../websockets/socket-groups'

// TODO(tec27): Make this @singleton() and inject it once lobbies are converted to TypeScript
export class GameplayActivityRegistry {
  private userClients = Map<SbUserId, ClientSocketsGroup>()

  /**
   * Attempts to register a client as owning the active gameplay activity for a user.
   *
   * @returns true if no other client was registered for the user, false otherwise.
   */
  registerActiveClient(userId: SbUserId, client: ClientSocketsGroup): boolean {
    if (this.userClients.has(userId)) {
      return false
    }

    this.userClients = this.userClients.set(userId, client)
    return true
  }

  /**
   * Unregisters the active client for a user.
   *
   * @returns true if a client was registered for that user, false otherwise.
   */
  unregisterClientForUser(userId: SbUserId): boolean {
    const updated = this.userClients.delete(userId)
    const result = updated !== this.userClients
    this.userClients = updated
    return result
  }

  /**
   * Returns the currently active client for a user. If no client was active, returns undefined.
   */
  getClientForUser(userId: SbUserId): ClientSocketsGroup | undefined {
    return this.userClients.get(userId)
  }
}

export default new GameplayActivityRegistry()
