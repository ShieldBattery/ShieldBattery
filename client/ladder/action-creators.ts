import { GetRankingsPayload } from '../../common/ladder'
import { MatchmakingType } from '../../common/matchmaking'
import { apiUrl } from '../../common/urls'
import { ThunkAction } from '../dispatch-registry'
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
      payload: fetchJson<GetRankingsPayload>(apiUrl`ladder/${matchmakingType}`),
      meta: { matchmakingType, fetchTime },
    })
  }
}
