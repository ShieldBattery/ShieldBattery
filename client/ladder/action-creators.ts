import { GetRankForUserResponse, GetRankingsResponse } from '../../common/ladder/index.js'
import { MatchmakingType } from '../../common/matchmaking.js'
import { apiUrl, urlPath } from '../../common/urls.js'
import { ThunkAction } from '../dispatch-registry.js'
import { push } from '../navigation/routing.js'
import { RequestHandlingSpec, abortableThunk } from '../network/abortable-thunk.js'
import { fetchJson } from '../network/fetch.js'

const LADDER_RANKINGS_CACHE_TIME_MS = 60 * 1000

const lastFetchTimeByMatchmakingType = new Map<MatchmakingType, number>()
const lastSearchTimeByMatchmakingType = new Map<MatchmakingType, number>()
const lastSearchQueryByMatchmakingType = new Map<MatchmakingType, string>()

export function getRankings(
  matchmakingType: MatchmakingType,
  spec: RequestHandlingSpec<void>,
): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    const fetchTime = performance.now()
    const lastFetchTime = lastFetchTimeByMatchmakingType.get(matchmakingType)

    if (lastFetchTime !== undefined && fetchTime - lastFetchTime < LADDER_RANKINGS_CACHE_TIME_MS) {
      return
    }

    lastFetchTimeByMatchmakingType.set(matchmakingType, fetchTime)

    const result = await fetchJson<GetRankingsResponse>(apiUrl`ladder/${matchmakingType}`, {
      signal: spec.signal,
    })

    // Don't update the state if we aren't the last request outstanding
    if (fetchTime >= (lastFetchTimeByMatchmakingType.get(matchmakingType) ?? 0)) {
      dispatch({
        type: '@ladder/getRankings',
        payload: result,
        meta: { matchmakingType, fetchTime: new Date() },
      })
    }
  })
}

export function searchRankings(
  matchmakingType: MatchmakingType,
  searchQuery: string,
  spec: RequestHandlingSpec<void>,
): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    const fetchTime = performance.now()
    const lastSearchTime = lastFetchTimeByMatchmakingType.get(matchmakingType)
    const lastSearchQuery = lastSearchQueryByMatchmakingType.get(matchmakingType)

    if (
      lastSearchTime !== undefined &&
      fetchTime - lastSearchTime < LADDER_RANKINGS_CACHE_TIME_MS &&
      lastSearchQuery === searchQuery
    ) {
      return
    }

    lastSearchTimeByMatchmakingType.set(matchmakingType, fetchTime)
    lastSearchQueryByMatchmakingType.set(matchmakingType, searchQuery)

    const result = await fetchJson<GetRankingsResponse>(
      apiUrl`ladder/${matchmakingType}` + (searchQuery ? urlPath`?q=${searchQuery}` : ''),
      {
        signal: spec.signal,
      },
    )

    // Don't update the state if we aren't the last request outstanding
    if (fetchTime >= (lastFetchTimeByMatchmakingType.get(matchmakingType) ?? 0)) {
      dispatch({
        type: '@ladder/searchRankings',
        payload: result,
        meta: { matchmakingType, searchQuery, fetchTime: new Date() },
      })
    }
  })
}

export function getInstantaneousSelfRank(spec: RequestHandlingSpec<void>): ThunkAction {
  return abortableThunk(spec, async (dispatch, getState) => {
    const { auth } = getState()
    const selfId = auth.self!.user.id

    const result = await fetchJson<GetRankForUserResponse>(apiUrl`ladder/users/${selfId}`, {
      signal: spec.signal,
    })

    dispatch({
      type: '@ladder/getInstantaneousSelfRank',
      payload: result,
    })
  })
}

/** Navigates to the ladder standings (optionally for a given matchmaking type). */
export function navigateToLadder(type?: MatchmakingType, transitionFn = push) {
  transitionFn(urlPath`/ladder/${type ?? ''}`)
}
