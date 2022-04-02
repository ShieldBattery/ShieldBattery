import { GetRankingsResponse } from '../../common/ladder'
import { MatchmakingType } from '../../common/matchmaking'
import { apiUrl, urlPath } from '../../common/urls'
import { ThunkAction } from '../dispatch-registry'
import { push } from '../navigation/routing'
import { abortableThunk, RequestHandlingSpec } from '../network/abortable-thunk'
import { fetchJson } from '../network/fetch'

const LADDER_RANKINGS_CACHE_TIME_MS = 60 * 1000

const lastFetchTimeByMatchmakingType = new Map<MatchmakingType, Date>()
const lastSearchQueryByMatchmakingType = new Map<MatchmakingType, string>()

export function getRankings(
  matchmakingType: MatchmakingType,
  searchQuery: string,
  spec: RequestHandlingSpec<void>,
): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    const fetchTime = new Date()
    const lastFetchTime = lastFetchTimeByMatchmakingType.get(matchmakingType) ?? new Date(0)
    const lastSearchQuery = lastSearchQueryByMatchmakingType.get(matchmakingType) ?? ''

    if (
      Number(fetchTime) - Number(lastFetchTime) < LADDER_RANKINGS_CACHE_TIME_MS &&
      lastSearchQuery === searchQuery
    ) {
      return
    }

    lastFetchTimeByMatchmakingType.set(matchmakingType, fetchTime)
    lastSearchQueryByMatchmakingType.set(matchmakingType, searchQuery)

    const result = await fetchJson<GetRankingsResponse>(
      apiUrl`ladder/${matchmakingType}`.concat(searchQuery ? urlPath`?q=${searchQuery}` : ''),
      {
        signal: spec.signal,
      },
    )

    if (fetchTime < lastFetchTime) {
      // Don't update the state if we aren't the last request outstanding
      return
    }

    dispatch({
      type: '@ladder/getRankings',
      payload: result,
      meta: { matchmakingType },
    })
  })
}

/** Navigates to the ladder standings (optionally for a given matchmaking type). */
export function navigateToLadder(type?: MatchmakingType, transitionFn = push) {
  transitionFn(urlPath`/ladder/${type ?? ''}`)
}
