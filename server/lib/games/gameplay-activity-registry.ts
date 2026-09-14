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
   * Moves a user's registered activity onto another of their clients, keeping the activity and the
   * status it was registered with. The user never stopped doing what they were doing, so their
   * published status is left exactly as it is — a game running on top of the activity has
   * overridden it with in-game, and re-announcing the activity's own status here would throw that
   * away.
   *
   * @returns true if the user had a registered activity to move, false otherwise.
   */
  rebindClient(userId: SbUserId, client: ClientSocketsGroup): boolean {
    if (!client.isConnected()) {
      throw new Error('Cannot register a disconnected client')
    }

    const registered = this.userClients.get(userId)
    if (!registered) {
      return false
    }

    this.userClients.set(userId, { client, status: registered.status })
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
   * Publishes a user's registered activity status again, for whoever still holds the activity to
   * reassert it. A running game overrides the activity's status with in-game, and clearing that
   * leaves the user looking merely online even though they are still in the lobby or queue that
   * started the game, so the holder says so again once the game is over. No-op for a user with no
   * registered activity.
   */
  reapplyStatus(userId: SbUserId): void {
    const registered = this.userClients.get(userId)
    if (!registered) {
      return
    }

    this.activityStatusService.setActivity(userId, registered.status)
  }

  /**
   * Returns the currently active client for a user. If no client was active, returns undefined.
   */
  getClientForUser(userId: SbUserId): ClientSocketsGroup | undefined {
    return this.userClients.get(userId)?.client
  }
}
