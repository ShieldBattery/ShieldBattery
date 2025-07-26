import { Jsonify } from '../json'
import { MatchmakingType } from '../matchmaking'

export const MATCHMAKING_TIMES_LIMIT = 5

export interface MatchmakingTime {
  id: number
  matchmakingType: MatchmakingType
  startDate: Date
  enabled: boolean
}

export type MatchmakingTimeJson = Jsonify<MatchmakingTime>

export function toMatchmakingTimeJson(matchmakingTime: MatchmakingTime): MatchmakingTimeJson {
  return {
    id: matchmakingTime.id,
    matchmakingType: matchmakingTime.matchmakingType,
    startDate: Number(matchmakingTime.startDate),
    enabled: matchmakingTime.enabled,
  }
}

export interface GetFutureMatchmakingTimesResponse {
  futureTimes: MatchmakingTimeJson[]
  hasMoreFutureTimes: boolean
}

export interface GetPastMatchmakingTimesResponse {
  pastTimes: MatchmakingTimeJson[]
  hasMorePastTimes: boolean
}

export interface AddMatchmakingTimeRequest {
  startDate: number
  enabled: boolean
  applyToAllMatchmakingTypes: boolean
}
