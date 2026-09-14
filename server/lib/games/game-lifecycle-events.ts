import { EventEmitter } from 'node:events'
import { singleton } from 'tsyringe'
import { SbUserId } from '../../../common/users/sb-user-id'

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

type GameLifecycleEventMap = {
  userGameEnded: [event: UserGameEndedEvent]
  gameEnded: [event: GameEndedEvent]
}

/**
 * Broadcasts the moments in a game's life that features outside `games/` need to react to.
 *
 * Its purpose is direction: a lobby outlives the games it launches and has to know when one is over
 * for each of its members, but `games/` importing `lobbies/` to tell it would be a dependency cycle.
 * Emitting here instead lets the listener depend on `games/` rather than the other way around.
 */
@singleton()
export class GameLifecycleEvents extends EventEmitter<GameLifecycleEventMap> {}
