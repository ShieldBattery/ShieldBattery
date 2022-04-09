import { GetRankingsResponse } from '../../common/ladder'
import { MatchmakingType } from '../../common/matchmaking'

export type LadderActions = GetRankings

/**
 * Retrieves the current rankings for a particular matchmaking type, optionally filtered by a search
 * query.
 */
export interface GetRankings {
  type: '@ladder/getRankings'
  payload: GetRankingsResponse
  error?: false
  meta: {
    matchmakingType: MatchmakingType
    searchQuery: string
  }
}
