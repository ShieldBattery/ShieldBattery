import { GetGamesResponse } from '../../common/games/games'
import {
  GetLeagueByIdResponse,
  GetLeagueLeaderboardResponse,
  GetLeaguesListResponse,
  JoinLeagueResponse,
  LeagueId,
} from '../../common/leagues/leagues'

export type LeaguesActions =
  | GetLeaguesList
  | GetLeague
  | JoinLeague
  | LeaveLeague
  | GetLeagueLeaderboard
  | GetLeagueGames

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

export interface LeaveLeague {
  type: '@leagues/leave'
  payload: { leagueId: LeagueId }
  error?: false
}

export interface GetLeagueLeaderboard {
  type: '@leagues/getLeaderboard'
  payload: GetLeagueLeaderboardResponse
  error?: false
}

export interface GetLeagueGames {
  type: '@leagues/getLeagueGames'
  payload: GetGamesResponse
  error?: false
}
