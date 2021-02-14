import { GetGamePayload } from '../../common/games/games'
import { apiUrl, urlPath } from '../../common/urls'
import { ThunkAction } from '../dispatch-registry'
import { push } from '../navigation/routing'
import { abortableThunk, RequestHandlingSpec } from '../network/abortable-thunk'
import fetch from '../network/fetch'
import { ResultsSubPage } from './results-sub-page'

/** Navigates to a game's result page (and optionally, a specific tab within that). */
export function navigateToGameResults(gameId: string, tab?: ResultsSubPage) {
  push(urlPath`/games/${gameId}/${tab ?? ''}`)
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
        payload: await fetch<GetGamePayload>(apiUrl`games/${gameId}`, {
          signal: spec.signal,
        }),
      })
    } finally {
      gameLoadsInProgress.delete(gameId)
    }
  })
}
