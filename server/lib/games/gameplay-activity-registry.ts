import { singleton } from 'tsyringe'
import { SbUserId } from '../../../common/users/sb-user.js'
import { ClientSocketsGroup } from '../websockets/socket-groups.js'

@singleton()
export class GameplayActivityRegistry {
  private userClients = new Map<SbUserId, ClientSocketsGroup>()

  /**
   * Attempts to register a client as owning the active gameplay activity for a user.
   *
   * @returns true if no other client was registered for the user, false otherwise.
   */
  registerActiveClient(userId: SbUserId, client: ClientSocketsGroup): boolean {
    if (this.userClients.has(userId)) {
      return false
    }

    this.userClients.set(userId, client)
    return true
  }

  /**
   * Attempts to register all of the specified clients as being in an active gameplay activity. If
   * any user already has an active client, no clients will be registered.
   *
   * @returns A tuple of if the clients were registered, and an array of user IDs that could not be
   *     registered (empty if they were registered).
   */
  registerAll(
    clients: ReadonlyArray<[userId: SbUserId, client: ClientSocketsGroup]>,
  ): [registered: boolean, alreadyActiveUsers: SbUserId[]] {
    const alreadyActiveUsers = clients
      .filter(([userId, _]) => this.userClients.has(userId))
      .map(([userId, _]) => userId)
    if (alreadyActiveUsers.length > 0) {
      return [false, alreadyActiveUsers]
    }

    for (const [userId, client] of clients) {
      this.userClients.set(userId, client)
    }
    return [true, []]
  }

  /**
   * Unregisters the active client for a user.
   *
   * @returns true if a client was registered for that user, false otherwise.
   */
  unregisterClientForUser(userId: SbUserId): boolean {
    return this.userClients.delete(userId)
  }

  /**
   * Returns the currently active client for a user. If no client was active, returns undefined.
   */
  getClientForUser(userId: SbUserId): ClientSocketsGroup | undefined {
    return this.userClients.get(userId)
  }
}
