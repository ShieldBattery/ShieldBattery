import { ReadonlyDeep } from 'type-fest'
import { GameConfig, GameSource } from '../../common/games/configuration'
import { GetGameResponse } from '../../common/games/games'
import { apiUrl, urlPath } from '../../common/urls'
import { ThunkAction } from '../dispatch-registry'
import logger from '../logging/logger'
import { findMatch } from '../matchmaking/action-creators'
import { push } from '../navigation/routing'
import { RequestHandlingSpec, abortableThunk } from '../network/abortable-thunk'
import { clientId } from '../network/client-id'
import { fetchJson } from '../network/fetch'
import { RequestCoalescer } from '../network/request-coalescer'
import { findMatchAsParty } from '../parties/action-creators'
import { openSnackbar } from '../snackbars/action-creators'
import { ResultsSubPage } from './results-sub-page'
import { toRouteGameId } from './route-game-id'

/**
 * Navigates to a game's result page (and optionally, a specific tab within that).
 *
 * @param gameId The ID of the game to navigate to
 * @param asPostGame If this is being shown as a post-game screen (and should have things like
 *     a requeue button, animations for score, etc.)
 * @param tab The tab within the results page to navigate to
 * @param transitionFn A function that will perform the transition to the new page
 */
export function navigateToGameResults(
  gameId: string,
  asPostGame?: boolean,
  tab?: ResultsSubPage,
  transitionFn = push,
) {
  const routeId = toRouteGameId(gameId)
  transitionFn(urlPath`/games/${routeId}/${tab ?? ''}` + (asPostGame ? '?post-game' : ''))
}

const viewGameRequestCoalescer = new RequestCoalescer<string>()

export function viewGame(gameId: string, spec: RequestHandlingSpec): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    await viewGameRequestCoalescer.makeRequest(gameId, spec.signal, async (signal: AbortSignal) => {
      dispatch({
        type: '@games/getGameRecord',
        payload: await fetchJson<GetGameResponse>(apiUrl`games/${gameId}`, {
          signal,
        }),
      })
    })
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

export function searchAgainFromGame(gameConfig: ReadonlyDeep<GameConfig>): ThunkAction {
  return (dispatch, getState) => {
    if (gameConfig.gameSource !== GameSource.Matchmaking) {
      return
    }

    const matchmakingType = gameConfig.gameSourceExtra.type

    const {
      party: { current },
      matchmakingPreferences: { byType },
    } = getState()
    const prefs = byType.get(matchmakingType)?.preferences

    if (!prefs) {
      // TODO(tec27): Request them?
      dispatch(openSnackbar({ message: 'There was a problem searching for a match' }))
      return
    }

    if (current) {
      dispatch(findMatchAsParty(matchmakingType, prefs ?? {}, current.id))
    } else {
      dispatch(findMatch(matchmakingType, prefs ?? {}))
    }
  }
}
