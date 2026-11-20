import {
  GameBrowseSideData,
  GameRecordUpdate,
  GetGameResponse,
  GetGamesResponse,
} from '../../common/games/games'
import { GameClientPlayerResult } from '../../common/games/results'

export type GamesActions = DeliverLocalResults | GetGameRecord | GetGames | BrowseGames | GameUpdate

export interface DeliverLocalResults {
  type: '@games/deliverLocalResults'
  payload: {
    gameId: string
    result: Record<string, GameClientPlayerResult>
    time: number
  }
  error?: false
}

export interface GetGameRecord {
  type: '@games/getGameRecord'
  payload: GetGameResponse
}

export interface GetGames {
  type: '@games/getGames'
  payload: GetGamesResponse
}

/** A response from one of the games browse view's endpoints, whose side data fills the stores. */
export interface BrowseGames {
  type: '@games/browseGames'
  payload: GameBrowseSideData
}

export interface GameUpdate {
  type: '@games/gameUpdate'
  payload: GameRecordUpdate
}
