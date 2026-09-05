import { singleton } from 'tsyringe'
import {
  FriendActivityStatus,
  FriendActivityStatusUpdateEvent,
} from '../../../common/users/relationships'
import { SbUserId } from '../../../common/users/sb-user-id'
import { Clock, TimeoutId } from '../time/clock'
import {
  ClientSocketsGroup,
  ClientSocketsManager,
  UserSocketsManager,
} from '../websockets/socket-groups'
import { TypedPublisher } from '../websockets/typed-publisher'

/**
 * How long a user stays in the in-game state after the client that was playing the game
 * disconnects, so that a short network blip doesn't bounce them out of (and back into) that state.
 */
const IN_GAME_DISCONNECT_GRACE_MS = 60_000

export function getFriendActivityStatusPath(userId: SbUserId): string {
  return `/friends/status/${userId}`
}

/**
 * The activity statuses that are owned by a client's entry in the gameplay activity registry (as
 * opposed to being derived from a game that is actually running).
 */
export type GameplayActivityStatus = FriendActivityStatus.InLobby | FriendActivityStatus.InQueue

interface GameplayActivity {
  status: GameplayActivityStatus
}

interface InGameActivity {
  status: FriendActivityStatus.InGame
  gameId: string
  /** The client that is playing the game, and whose disconnect ends the in-game state. */
  clientId: string
  /** Set while the client is disconnected and the grace period hasn't elapsed yet. */
  disconnectTimer?: TimeoutId
  /** Removes the close listener that starts the disconnect grace period. */
  unbindClose: () => void
}

type Activity = GameplayActivity | InGameActivity

/**
 * Tracks what each user is currently doing and publishes changes to their friends. This is the
 * single source of truth for `FriendActivityStatus`: everything that can change it (the gameplay
 * activity registry, the game loader, game status reports from clients, and socket connects and
 * disconnects) routes through here.
 */
@singleton()
export class ActivityStatusService {
  private activities = new Map<SbUserId, Activity>()

  constructor(
    private publisher: TypedPublisher<FriendActivityStatusUpdateEvent>,
    private userSocketsManager: UserSocketsManager,
    clientSocketsManager: ClientSocketsManager,
    private clock: Clock,
  ) {
    userSocketsManager
      .on('newUser', userSockets => {
        this.publish(userSockets.userId, this.getStatus(userSockets.userId))
      })
      .on('userQuit', userId => {
        // The activity entry is deliberately left in place: lobby and queue entries get cleared
        // when those services react to the disconnect, and an in-game entry has to outlive a brief
        // disconnect so that a reconnecting player is still playing their game.
        this.publish(userId, FriendActivityStatus.Offline)
      })

    clientSocketsManager.on('newClient', client => {
      const activity = this.activities.get(client.userId)
      if (
        activity?.status !== FriendActivityStatus.InGame ||
        activity.clientId !== client.clientId ||
        activity.disconnectTimer === undefined
      ) {
        return
      }

      this.clock.clearTimeout(activity.disconnectTimer)
      activity.disconnectTimer = undefined
      activity.unbindClose = this.bindClose(client.userId, client, activity)
    })
  }

  /** Returns what the given user is currently doing. */
  getStatus(userId: SbUserId): FriendActivityStatus {
    if (!this.userSocketsManager.getById(userId)) {
      return FriendActivityStatus.Offline
    }

    return this.activities.get(userId)?.status ?? FriendActivityStatus.Online
  }

  /** Marks a user as being in a lobby or in the matchmaking queue. */
  setActivity(userId: SbUserId, status: GameplayActivityStatus): void {
    this.updateActivity(userId, { status })
  }

  /**
   * Clears a user's lobby or matchmaking queue activity. This only has an effect if that is what
   * the user is currently doing: a user that has since moved on to playing the game stays in the
   * in-game state.
   */
  clearActivity(userId: SbUserId, status: GameplayActivityStatus): void {
    if (this.activities.get(userId)?.status !== status) {
      return
    }

    this.updateActivity(userId, undefined)
  }

  /**
   * Marks a user as playing a game. The state lasts until the game is reported as over, or until
   * `client` has been disconnected for longer than the grace period.
   */
  setInGame(userId: SbUserId, gameId: string, client: ClientSocketsGroup): void {
    const activity: InGameActivity = {
      status: FriendActivityStatus.InGame,
      gameId,
      clientId: client.clientId,
      unbindClose: () => {},
    }
    activity.unbindClose = this.bindClose(userId, client, activity)

    this.updateActivity(userId, activity)
  }

  /** Clears a user's in-game state, if they are currently playing the given game. */
  clearInGame(userId: SbUserId, gameId: string): void {
    const current = this.activities.get(userId)
    if (current?.status !== FriendActivityStatus.InGame || current.gameId !== gameId) {
      return
    }

    this.updateActivity(userId, undefined)
  }

  private updateActivity(userId: SbUserId, activity: Activity | undefined): void {
    const prevStatus = this.getStatus(userId)
    const prev = this.activities.get(userId)
    if (prev && prev !== activity) {
      tearDownActivity(prev, this.clock)
    }

    if (activity) {
      this.activities.set(userId, activity)
    } else {
      this.activities.delete(userId)
    }

    const status = this.getStatus(userId)
    if (status !== prevStatus) {
      this.publish(userId, status)
    }
  }

  private bindClose(
    userId: SbUserId,
    client: ClientSocketsGroup,
    activity: InGameActivity,
  ): () => void {
    const onClose = () => {
      activity.disconnectTimer = this.clock.setTimeout(() => {
        activity.disconnectTimer = undefined
        if (this.activities.get(userId) !== activity) {
          return
        }

        this.activities.delete(userId)
        if (this.userSocketsManager.getById(userId)) {
          this.publish(userId, this.getStatus(userId))
        }
      }, IN_GAME_DISCONNECT_GRACE_MS)
    }

    client.once('close', onClose)
    if (!client.isConnected()) {
      // A group that has no sockets left has already emitted its close event, so the listener above
      // would never fire and the entry would be stuck in-game forever.
      onClose()
    }

    return () => client.off('close', onClose)
  }

  private publish(userId: SbUserId, status: FriendActivityStatus): void {
    this.publisher.publish(getFriendActivityStatusPath(userId), { userId, status })
  }
}

function tearDownActivity(activity: Activity, clock: Clock): void {
  if (activity.status !== FriendActivityStatus.InGame) {
    return
  }

  if (activity.disconnectTimer !== undefined) {
    clock.clearTimeout(activity.disconnectTimer)
    activity.disconnectTimer = undefined
  }
  activity.unbindClose()
}
