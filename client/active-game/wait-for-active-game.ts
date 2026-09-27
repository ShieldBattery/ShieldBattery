import createDeferred, { Deferred } from '../../common/async/deferred'
import { ReportedGameStatus } from '../../common/games/game-status'

const waitingGames = new Map<string, Deferred<void>>()

/**
 * Games that reached playing (or error) before anything waited on them, keyed by game ID. A caller
 * usually only learns a game's ID once the launch has started, and a fast launch can reach playing
 * before that caller gets to wait (e.g. while the code for the dialog that waits is still loading),
 * so the outcome is kept for a late waiter. Only the most recent few are kept, since game IDs are
 * never reused and an unclaimed entry is otherwise never read again.
 */
const settledGames = new Map<string, ReportedGameStatus>()
const MAX_SETTLED_GAMES = 8

/**
 * Returns a Promise that will resolve when a game with the specified ID enters playing state, or
 * rejects if it enters an error state. A game that already did either before this was called
 * settles the Promise immediately.
 *
 * Note that this will not time out, and there is no guarantee that a game with this ID has even
 * been launched. Thus, you should generally use this alongside some kind of timeout.
 */
export function waitForActiveGame(gameId: string): Promise<void> {
  const settled = settledGames.get(gameId)
  if (settled) {
    settledGames.delete(gameId)
    return settled.state === 'playing'
      ? Promise.resolve()
      : Promise.reject(new Error(settled.extra))
  }

  if (!waitingGames.has(gameId)) {
    waitingGames.set(gameId, createDeferred<void>())
  }

  return waitingGames.get(gameId)!.then(() => {})
}

export function updateActiveGame(status: ReportedGameStatus) {
  if (status.state !== 'playing' && status.state !== 'error') {
    return
  }

  const waiting = waitingGames.get(status.id)
  if (!waiting) {
    settledGames.delete(status.id)
    settledGames.set(status.id, status)
    if (settledGames.size > MAX_SETTLED_GAMES) {
      settledGames.delete(settledGames.keys().next().value!)
    }
    return
  }

  if (status.state === 'playing') {
    waiting.resolve()
  } else {
    waiting.reject(new Error(status.extra))
  }
  waitingGames.delete(status.id)
}
