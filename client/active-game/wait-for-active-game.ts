import createDeferred, { Deferred } from '../../common/async/deferred.js'
import { ReportedGameStatus } from '../../common/game-status.js'

const waitingGames = new Map<string, Deferred<void>>()

/**
 * Returns a Promise that will resolve when a game with the specified ID enters playing state, or
 * rejects if it enters an error state.
 *
 * Note that this will not time out, and there is no guarantee that a game with this ID has even
 * been launched. Thus, you should generally use this alongside some kind of timeout.
 */
export function waitForActiveGame(gameId: string): Promise<void> {
  if (!waitingGames.has(gameId)) {
    waitingGames.set(gameId, createDeferred<void>())
  }

  return waitingGames.get(gameId)!.then(() => {})
}

export function updateActiveGame(status: ReportedGameStatus) {
  if (waitingGames.has(status.id)) {
    if (status.state === 'playing') {
      waitingGames.get(status.id)!.resolve()
      waitingGames.delete(status.id)
    } else if (status.state === 'error') {
      waitingGames.get(status.id)!.reject(new Error(status.extra))
      waitingGames.delete(status.id)
    }
  }
}
