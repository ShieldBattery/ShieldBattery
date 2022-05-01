import { GetRankingsResponse } from '../../common/ladder'
import { MatchmakingType } from '../../common/matchmaking'

export type LadderActions = GetRankings | SearchRankings

/**
 * Retrieves the current rankings for a particular matchmaking type.
 */
export interface GetRankings {
  type: '@ladder/getRankings'
  payload: GetRankingsResponse
  error?: false
  meta: {
    matchmakingType: MatchmakingType
    fetchTime: Date
  }
}

/**
 * Retrieves the current rankings for a particular matchmaking type, filtered by a search query.
 */
export interface SearchRankings {
  type: '@ladder/searchRankings'
  payload: GetRankingsResponse
  error?: false
  meta: {
    matchmakingType: MatchmakingType
    searchQuery: string
    fetchTime: Date
  }
}
