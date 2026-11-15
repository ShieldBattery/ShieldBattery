import { EventEmitter } from 'node:events'
import { singleton } from 'tsyringe'
import { SbUserId } from '../../../common/users/sb-user-id'
import { Clock } from '../time/clock'

/**
 * One user's participation in a game has ended: their client reported a terminal status for it, or
 * their result report was stored.
 *
 * Both of those can happen for the same user and game (and either can happen without the other, if
 * a client dies partway through), so this is an at-least-once signal — a listener has to make its
 * handling idempotent per (game, user) rather than counting the events it receives.
 */
export interface UserGameEndedEvent {
  gameId: string
  userId: SbUserId
}

/**
 * A whole game is over: something authoritative observed its end, independent of any single
 * player's report — e.g. the netcode relay session closing, or the reconcile sweep declaring it
 * complete. Clients that die without ever reporting (a crashed app posts nothing) are covered by
 * this where the per-user signal never fires. At-least-once, and may arrive alongside per-user
 * events for the same game.
 */
export interface GameEndedEvent {
  gameId: string
}

/**
 * A game's results have been reconciled and written: its outcome and length are final and readable
 * from its record.
 *
 * This is a separate moment from the game merely ending — reconciliation happens once every
 * required player has reported (or a sweep gives up waiting), which is generally after the end
 * signals above, and never at all for a game that reports no results.
 */
export interface GameReconciledEvent {
  gameId: string
}

type GameLifecycleEventMap = {
  userGameEnded: [event: UserGameEndedEvent]
  gameEnded: [event: GameEndedEvent]
  gameReconciled: [event: GameReconciledEvent]
}

/**
 * How long an announced end stays queryable. It has to outlast the longest a game load can run,
 * because the load completing is the latest point at which a consumer starts tracking a game.
 */
export const END_RETENTION_MS = 10 * 60 * 1000

interface EndRecord {
  users: Set<SbUserId>
  everyone: boolean
  recordedAt: number
}

/**
 * Broadcasts the moments in a game's life that features outside `games/` need to react to.
 *
 * Its purpose is direction: a lobby outlives the games it launches and has to know when one is over
 * for each of its members, but `games/` importing `lobbies/` to tell it would be a dependency cycle.
 * Emitting here instead lets the listener depend on `games/` rather than the other way around.
 *
 * The end events are announced once, but a consumer can begin tracking a game after its end was
 * announced (a networked game's load can complete on the server after a short game is already
 * over), and it would never see them. So the ends are also remembered for a while and can be asked
 * about with `hasGameEnded` and `hasUserGameEnded`.
 */
@singleton()
export class GameLifecycleEvents extends EventEmitter<GameLifecycleEventMap> {
  /** Recorded ends by game id, ordered by `recordedAt` ascending (oldest first). */
  private ends = new Map<string, EndRecord>()

  constructor(private clock: Clock) {
    super()
    // Registered first, so every other listener can already query the fact it is being told about.
    this.on('userGameEnded', ({ gameId, userId }) => {
      this.record(gameId).users.add(userId)
    })
    this.on('gameEnded', ({ gameId }) => {
      this.record(gameId).everyone = true
    })
  }

  /** Whether the whole game's end has been announced. */
  hasGameEnded(gameId: string): boolean {
    return this.get(gameId)?.everyone ?? false
  }

  /** Whether this user's end, or the whole game's end, has been announced. */
  hasUserGameEnded(gameId: string, userId: SbUserId): boolean {
    const record = this.get(gameId)
    return !!record && (record.everyone || record.users.has(userId))
  }

  private get(gameId: string): EndRecord | undefined {
    const record = this.ends.get(gameId)
    return record && this.clock.now() - record.recordedAt < END_RETENTION_MS ? record : undefined
  }

  private record(gameId: string): EndRecord {
    const now = this.clock.now()
    const record = this.ends.get(gameId) ?? {
      users: new Set<SbUserId>(),
      everyone: false,
      recordedAt: now,
    }
    record.recordedAt = now
    // Re-inserting moves the key to the back, which keeps the map ordered oldest-first.
    this.ends.delete(gameId)
    this.ends.set(gameId, record)

    for (const [id, other] of this.ends) {
      if (now - other.recordedAt < END_RETENTION_MS) {
        break
      }
      this.ends.delete(id)
    }
    return record
  }
}
