import { GetRankingsResponse } from '../../common/ladder'
import { MatchmakingType } from '../../common/matchmaking'
import { apiUrl, urlPath } from '../../common/urls'
import { ThunkAction } from '../dispatch-registry'
import { push } from '../navigation/routing'
import { abortableThunk, RequestHandlingSpec } from '../network/abortable-thunk'
import { fetchJson } from '../network/fetch'

const LADDER_RANKINGS_CACHE_TIME_MS = 60 * 1000

const lastFetchTimeByMatchmakingType = new Map<MatchmakingType, number>()
const lastSearchTimeByMatchmakingType = new Map<MatchmakingType, number>()
const lastSearchQueryByMatchmakingType = new Map<MatchmakingType, string>()

export function getRankings(
  matchmakingType: MatchmakingType,
  searchQuery: string,
  spec: RequestHandlingSpec<void>,
): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    // `performance.now()` can return value that's less than our cache time, so we floor it to that.
    const fetchTime = performance.now() + LADDER_RANKINGS_CACHE_TIME_MS
    const lastFetchTime = lastFetchTimeByMatchmakingType.get(matchmakingType) ?? 0
    const lastSearchTime = lastFetchTimeByMatchmakingType.get(matchmakingType) ?? 0
    const lastSearchQuery = lastSearchQueryByMatchmakingType.get(matchmakingType) ?? ''

    if (searchQuery) {
      if (
        fetchTime - lastSearchTime < LADDER_RANKINGS_CACHE_TIME_MS &&
        lastSearchQuery === searchQuery
      ) {
        return
      }

      lastSearchTimeByMatchmakingType.set(matchmakingType, fetchTime)
    } else {
      if (fetchTime - lastFetchTime < LADDER_RANKINGS_CACHE_TIME_MS) {
        return
      }

      lastFetchTimeByMatchmakingType.set(matchmakingType, fetchTime)
    }

    lastSearchQueryByMatchmakingType.set(matchmakingType, searchQuery)

    const result = await fetchJson<GetRankingsResponse>(
      apiUrl`ladder/${matchmakingType}` + (searchQuery ? urlPath`?q=${searchQuery}` : ''),
      {
        signal: spec.signal,
      },
    )

    // Don't update the state if we aren't the last request outstanding
    if (fetchTime >= lastFetchTimeByMatchmakingType.get(matchmakingType)!) {
      dispatch({
        type: '@ladder/getRankings',
        payload: result,
        meta: { matchmakingType, searchQuery },
      })
    }
  })
}

/** Navigates to the ladder standings (optionally for a given matchmaking type). */
export function navigateToLadder(type?: MatchmakingType, transitionFn = push) {
  transitionFn(urlPath`/ladder/${type ?? ''}`)
}
