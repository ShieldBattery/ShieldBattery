import { GetRankingsResponse } from '../../common/ladder'
import { MatchmakingType } from '../../common/matchmaking'
import { apiUrl, urlPath } from '../../common/urls'
import { ThunkAction } from '../dispatch-registry'
import { push } from '../navigation/routing'
import { fetchJson } from '../network/fetch'

const LADDER_RANKINGS_CACHE_TIME_MS = 60 * 1000

export function getRankings(matchmakingType: MatchmakingType): ThunkAction {
  return (dispatch, getState) => {
    const fetchTime = new Date()
    const {
      ladder: { typeToRankings },
    } = getState()
    const rankings = typeToRankings.get(matchmakingType)
    const lastFetchTime = rankings?.fetchTime ?? 0

    if (
      !rankings?.lastError &&
      Number(fetchTime) - Number(lastFetchTime) < LADDER_RANKINGS_CACHE_TIME_MS
    ) {
      return
    }

    dispatch({ type: '@ladder/getRankingsBegin', payload: { matchmakingType, fetchTime } })
    dispatch({
      type: '@ladder/getRankings',
      payload: fetchJson<GetRankingsResponse>(apiUrl`ladder/${matchmakingType}`),
      meta: { matchmakingType, fetchTime },
    })
  }
}

/** Navigates to the ladder standings (optionally for a given matchmaking type). */
export function navigateToLadder(type?: MatchmakingType, transitionFn = push) {
  transitionFn(urlPath`/ladder/${type ?? ''}`)
}
