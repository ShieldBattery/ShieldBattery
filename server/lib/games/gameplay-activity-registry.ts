import { singleton } from 'tsyringe'
import { SbUserId } from '../../../common/users/sb-user-id'
import { ActivityStatusService, GameplayActivityStatus } from '../users/activity-status-service'
import { ClientSocketsGroup } from '../websockets/socket-groups'

interface RegisteredActivity {
  client: ClientSocketsGroup
  status: GameplayActivityStatus
}

@singleton()
export class GameplayActivityRegistry {
  private userClients = new Map<SbUserId, RegisteredActivity>()

  constructor(private activityStatusService: ActivityStatusService) {}

  /**
   * Attempts to register a client as owning the active gameplay activity for a user.
   *
   * @returns true if no other client was registered for the user, false otherwise.
   */
  registerActiveClient(
    userId: SbUserId,
    client: ClientSocketsGroup,
    status: GameplayActivityStatus,
  ): boolean {
    if (!client.isConnected()) {
      throw new Error('Cannot register a disconnected client')
    }

    if (this.userClients.has(userId)) {
      return false
    }

    this.userClients.set(userId, { client, status })
    this.activityStatusService.setActivity(userId, status)
    return true
  }

  /**
   * Unregisters the active client for a user.
   *
   * @returns true if a client was registered for that user, false otherwise.
   */
  unregisterClientForUser(userId: SbUserId): boolean {
    const registered = this.userClients.get(userId)
    if (!registered) {
      return false
    }

    this.userClients.delete(userId)
    this.activityStatusService.clearActivity(userId, registered.status)
    return true
  }

  /**
   * Returns the currently active client for a user. If no client was active, returns undefined.
   */
  getClientForUser(userId: SbUserId): ClientSocketsGroup | undefined {
    return this.userClients.get(userId)?.client
  }
}
