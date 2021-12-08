import { GetGameResponse } from '../../common/games/games'
import { apiUrl, urlPath } from '../../common/urls'
import { ThunkAction } from '../dispatch-registry'
import logger from '../logging/logger'
import { push } from '../navigation/routing'
import { abortableThunk, RequestHandlingSpec } from '../network/abortable-thunk'
import { clientId } from '../network/client-id'
import { fetchJson } from '../network/fetch'
import { ResultsSubPage } from './results-sub-page'

/** Navigates to a game's result page (and optionally, a specific tab within that). */
export function navigateToGameResults(gameId: string, tab?: ResultsSubPage, transitionFn = push) {
  transitionFn(urlPath`/games/${gameId}/${tab ?? ''}`)
}

const gameLoadsInProgress = new Set<string>()

export function viewGame(gameId: string, spec: RequestHandlingSpec): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    if (gameLoadsInProgress.has(gameId)) {
      return
    }
    gameLoadsInProgress.add(gameId)

    try {
      dispatch({
        type: '@games/getGameRecord',
        payload: await fetchJson<GetGameResponse>(apiUrl`games/${gameId}`, {
          signal: spec.signal,
        }),
      })
    } finally {
      gameLoadsInProgress.delete(gameId)
    }
  })
}

export function subscribeToGame(gameId: string): ThunkAction {
  return () => {
    fetchJson(apiUrl`games/${gameId}/subscribe?clientId=${clientId}`, { method: 'post' }).catch(
      err => {
        // TODO(tec27): Handle this error in some way? Doesn't actually seem that important for the
        // user to know about
        logger.error(`Error subscribing to game ${gameId}: ${(err as any)?.stack ?? err}`)
      },
    )
  }
}

export function unsubscribeFromGame(gameId: string): ThunkAction {
  return () => {
    fetchJson(apiUrl`games/${gameId}/unsubscribe?clientId=${clientId}`, { method: 'post' }).catch(
      err => {
        // TODO(tec27): Handle this error in some way? Doesn't actually seem that important for the
        // user to know about
        logger.error(`Error unsubscribing from game ${gameId}: ${(err as any)?.stack ?? err}`)
      },
    )
  }
}
