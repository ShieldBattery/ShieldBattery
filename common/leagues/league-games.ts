import {
  EncodedMatchupString,
  GameDurationFilter,
  GameFormat,
  GameSortOption,
} from '../games/game-filters'
import { GameRecordJson, GameReplayInfo } from '../games/games'
import { MapInfoJson } from '../maps'
import { SbUser } from '../users/sb-user'

export const GET_LEAGUE_GAMES_LIMIT = 40

export interface GetLeagueGamesQueryParams {
  duration?: GameDurationFilter
  mapName?: string
  playerName?: string
  format?: GameFormat
  matchup?: EncodedMatchupString
  sort?: GameSortOption
  offset?: number
  /** Inclusive lower bound (unix ms) on the game's start time. */
  startDate?: number
  /** Inclusive upper bound (unix ms) on the game's start time. */
  endDate?: number
}

export interface GetLeagueGamesResponse {
  games: GameRecordJson[]
  maps: MapInfoJson[]
  users: SbUser[]
  hasMoreGames: boolean
  replays: GameReplayInfo[]
}
