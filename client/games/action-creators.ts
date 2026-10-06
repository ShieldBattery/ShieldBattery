import { ReadonlyDeep } from 'type-fest'
import {
  GameReplayDebugInfo,
  GetGameResponse,
  GetGamesQueryParams,
  GetGamesResponse,
  ReviewRequestResponse,
} from '../../common/games/games'
import { TypedIpcRenderer } from '../../common/ipc'
import { apiUrl, urlPath } from '../../common/urls'
import { SbUserId } from '../../common/users/sb-user-id'
import { ThunkAction } from '../dispatch-registry'
import logger from '../logging/logger'
import { push } from '../navigation/routing'
import { abortableThunk, RequestHandlingSpec } from '../network/abortable-thunk'
import { clientId } from '../network/client-id'
import { fetchJson } from '../network/fetch'
import { RequestCoalescer } from '../network/request-coalescer'
import { ensureReplayCached } from '../replays/action-creators'
import { buildChatTranscript, ChatTranscript } from './chat-transcript'
import { buildGameListSearchParams } from './game-filter-url'
import { ResultsSubPage } from './results-sub-page'
import { toRouteGameId } from './route-game-id'

export function getGameResultsUrl(gameId: string, asPostGame?: boolean, tab?: ResultsSubPage) {
  const routeId = toRouteGameId(gameId)
  return urlPath`/games/${routeId}/${tab ?? ''}` + (asPostGame ? '?post-game' : '')
}

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
  transitionFn(getGameResultsUrl(gameId, asPostGame, tab))
}

const ipcRenderer = new TypedIpcRenderer()

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

/**
 * Asks an admin to review the disputed results of a game the current user played, then reloads the
 * game so its page reflects the request.
 */
export function requestGameReview(gameId: string, spec: RequestHandlingSpec): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    await fetchJson<ReviewRequestResponse>(apiUrl`games/${gameId}/review-request`, {
      method: 'POST',
      signal: spec.signal,
    })
    dispatch({
      type: '@games/getGameRecord',
      payload: await fetchJson<GetGameResponse>(apiUrl`games/${gameId}`, { signal: spec.signal }),
    })
  })
}

/**
 * Marks a game's pending review request as reviewed without resolving the game (an admin action),
 * then reloads the game so its page reflects the dismissal.
 */
export function dismissGameReviewRequest(gameId: string, spec: RequestHandlingSpec): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    await fetchJson<ReviewRequestResponse>(apiUrl`games/${gameId}/review-request/dismiss`, {
      method: 'POST',
      signal: spec.signal,
    })
    dispatch({
      type: '@games/getGameRecord',
      payload: await fetchJson<GetGameResponse>(apiUrl`games/${gameId}`, { signal: spec.signal }),
    })
  })
}

export function getGames(
  params: GetGamesQueryParams,
  spec: RequestHandlingSpec<GetGamesResponse>,
): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    const queryParams = buildGameListSearchParams(params)

    const result = await fetchJson<GetGamesResponse>(apiUrl`games/list?${queryParams}`, {
      signal: spec.signal,
    })

    dispatch({
      type: '@games/getGames',
      payload: result,
    })

    return result
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

/**
 * Builds a game's chat transcript by downloading (into the local replay cache) and merging the
 * chat of one replay per side, as chosen by `selectChatTranscriptReplays`.
 */
export function loadGameChatTranscript(
  sides: ReadonlyArray<ReadonlyArray<SbUserId>>,
  replays: ReadonlyArray<{ side: number; replay: ReadonlyDeep<GameReplayDebugInfo> }>,
  spec: RequestHandlingSpec<ChatTranscript>,
): ThunkAction {
  return abortableThunk(spec, async () => {
    const sources = await Promise.all(
      replays.map(async ({ side, replay }) => {
        const path = await ensureReplayCached(replay, spec.signal)
        const chat = path ? await ipcRenderer.invoke('replayParseChat', path) : undefined
        if (!chat) {
          throw new Error(`Couldn't read the chat from replay ${replay.id}`)
        }
        return { side, chat }
      }),
    )
    return buildChatTranscript(sources, sides)
  })
}
