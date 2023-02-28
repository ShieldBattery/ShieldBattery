import {
  GetLeagueByIdResponse,
  GetLeagueLeaderboardResponse,
  GetLeaguesListResponse,
  JoinLeagueResponse,
} from '../../common/leagues'

export type LeaguesActions = GetLeaguesList | GetLeague | JoinLeague | GetLeagueLeaderboard

export interface GetLeaguesList {
  type: '@leagues/getList'
  payload: GetLeaguesListResponse
  error?: false
}

export interface GetLeague {
  type: '@leagues/get'
  payload: GetLeagueByIdResponse
  error?: false
}

export interface JoinLeague {
  type: '@leagues/join'
  payload: JoinLeagueResponse
  error?: false
}

export interface GetLeagueLeaderboard {
  type: '@leagues/getLeaderboard'
  payload: GetLeagueLeaderboardResponse
  error?: false
}
