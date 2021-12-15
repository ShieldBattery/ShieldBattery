import { GetRankingsResponse } from '../../common/ladder'
import { MatchmakingType } from '../../common/matchmaking'
import { BaseFetchFailure } from '../network/fetch-errors'

export type LadderActions = GetRankingsBegin | GetRankingsSuccess | GetRankingsFailure

/**
 * A request is being made to the server to retrieve the current rankings for a particular
 * matchmaking type.
 */
export interface GetRankingsBegin {
  type: '@ladder/getRankingsBegin'
  payload: {
    matchmakingType: MatchmakingType
    fetchTime: Date
  }
}

/**
 * The server has returned the current rankings for a particular matchmaking type.
 */
export interface GetRankingsSuccess {
  type: '@ladder/getRankings'
  payload: GetRankingsResponse
  error?: false
  meta: {
    matchmakingType: MatchmakingType
    fetchTime: Date
  }
}

/**
 * A request for the current rankings has failed.
 */
export interface GetRankingsFailure extends BaseFetchFailure<'@ladder/getRankings'> {
  meta: {
    matchmakingType: MatchmakingType
    fetchTime: Date
  }
}
