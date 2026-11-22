import createDeferred, { Deferred } from '../../common/async/deferred'
import { GameLaunchErrorKind, ReportedGameStatus } from '../../common/games/game-status'

const waitingGames = new Map<string, Deferred<void>>()

/**
 * Games that reached playing, error or quit before anything waited on them, keyed by game ID. A
 * caller usually only learns a game's ID once the launch has started, and a fast launch can reach
 * playing before that caller gets to wait (e.g. while the code for the dialog that waits is still
 * loading), so the outcome is kept for a late waiter. Only the most recent few are kept, since game
 * IDs are never reused and an unclaimed entry is otherwise never read again.
 */
const settledGames = new Map<string, ReportedGameStatus>()
const MAX_SETTLED_GAMES = 8

/** What {@link waitForActiveGame} rejects with when the game entered an error state. */
export class ActiveGameError extends Error {
  /** Why the launch failed, when it was for a reason the player can act on. */
  readonly launchErrorKind?: GameLaunchErrorKind

  constructor(status: ReportedGameStatus) {
    super(status.extra)
    this.launchErrorKind = status.launchErrorKind
  }
}

/**
 * What {@link waitForActiveGame} rejects with when the app quit the game before it started playing,
 * e.g. a replay closed because a game the user takes part in launched. Quitting is deliberate, so
 * this isn't a failure to report to the user.
 */
export class ActiveGameQuitError extends Error {
  constructor(gameId: string) {
    super(`Game ${gameId} was quit before it started playing`)
  }
}

/**
 * Returns a Promise that will resolve when a game with the specified ID enters playing state, or
 * rejects with an {@link ActiveGameError} if it enters an error state, or an
 * {@link ActiveGameQuitError} if it's quit before either. A game that already did any of these
 * before this was called settles the Promise immediately.
 *
 * Note that this will not time out, and there is no guarantee that a game with this ID has even
 * been launched. Thus, you should generally use this alongside some kind of timeout.
 */
export function waitForActiveGame(gameId: string): Promise<void> {
  const settled = settledGames.get(gameId)
  if (settled) {
    settledGames.delete(gameId)
    return settle(settled)
  }

  if (!waitingGames.has(gameId)) {
    waitingGames.set(gameId, createDeferred<void>())
  }

  return waitingGames.get(gameId)!.then(() => {})
}

function settle(status: ReportedGameStatus): Promise<void> {
  switch (status.state) {
    case 'playing':
      return Promise.resolve()
    case 'unknown':
      return Promise.reject(new ActiveGameQuitError(status.id))
    default:
      return Promise.reject(new ActiveGameError(status))
  }
}

export function updateActiveGame(status: ReportedGameStatus) {
  // A game reports `unknown` once the app stops tracking it: when it's quit, or when it exits.
  // Only a game that hasn't yet reached playing or error is still waited on (or unsettled) then.
  if (status.state !== 'playing' && status.state !== 'error' && status.state !== 'unknown') {
    return
  }

  const waiting = waitingGames.get(status.id)
  if (!waiting) {
    if (status.state === 'unknown' && settledGames.has(status.id)) {
      // An exit after playing (or error) doesn't change how the launch turned out.
      return
    }
    settledGames.delete(status.id)
    settledGames.set(status.id, status)
    if (settledGames.size > MAX_SETTLED_GAMES) {
      settledGames.delete(settledGames.keys().next().value!)
    }
    return
  }

  waiting.resolve(settle(status))
  waitingGames.delete(status.id)
}
