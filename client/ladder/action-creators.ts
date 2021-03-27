import { GetRankingsPayload } from '../../common/ladder'
import { MatchmakingType } from '../../common/matchmaking'
import { ThunkAction } from '../dispatch-registry'
import fetch from '../network/fetch'
import { apiUrl } from '../network/urls'
import { RootState } from '../root-reducer'

const LADDER_RANKINGS_CACHE_TIME_MS = 60 * 1000

export function getRankings(matchmakingType: MatchmakingType): ThunkAction {
  // NOTE(tec27): Not sure why, but getState here is sometimes typed as () => any unless we are
  // explicit about its typing
  return (dispatch, getState: () => RootState) => {
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
      payload: fetch<GetRankingsPayload>(apiUrl`ladder/${matchmakingType}`),
      meta: { matchmakingType, fetchTime },
    })
  }
}
