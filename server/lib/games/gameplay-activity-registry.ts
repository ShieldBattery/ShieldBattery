import { singleton } from 'tsyringe'
import { FriendActivityLobby, FriendActivityStatus } from '../../../common/users/relationships'
import { SbUserId } from '../../../common/users/sb-user-id'
import { ActivityStatusService, GameplayActivity } from '../users/activity-status-service'
import { ClientSocketsGroup } from '../websockets/socket-groups'

interface RegisteredActivity {
  client: ClientSocketsGroup
  activity: GameplayActivity
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
    activity: GameplayActivity,
  ): boolean {
    if (!client.isConnected()) {
      throw new Error('Cannot register a disconnected client')
    }

    if (this.userClients.has(userId)) {
      return false
    }

    this.userClients.set(userId, { client, activity })
    this.activityStatusService.setActivity(userId, activity)
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

    this.userClients.set(userId, { client, activity: registered.activity })
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
    this.activityStatusService.clearActivity(userId, registered.activity.status)
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

    this.activityStatusService.setActivity(userId, registered.activity)
  }

  /**
   * Replaces the details of the lobby a user is registered as being in, e.g. after the lobby was
   * renamed, so that both the published status and any later `reapplyStatus` describe the lobby as
   * it is now. No-op for a user whose registered activity isn't being in that lobby.
   */
  updateLobby(userId: SbUserId, lobby: FriendActivityLobby): void {
    const registered = this.userClients.get(userId)
    if (
      registered?.activity.status !== FriendActivityStatus.InLobby ||
      registered.activity.lobby.id !== lobby.id
    ) {
      return
    }

    this.userClients.set(userId, {
      client: registered.client,
      activity: { status: FriendActivityStatus.InLobby, lobby },
    })
    this.activityStatusService.updateLobby(userId, lobby)
  }

  /**
   * Returns the currently active client for a user. If no client was active, returns undefined.
   */
  getClientForUser(userId: SbUserId): ClientSocketsGroup | undefined {
    return this.userClients.get(userId)?.client
  }
}
