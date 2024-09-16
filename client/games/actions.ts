import { GameRecordUpdate, GetGameResponse } from '../../common/games/games.js'
import { GameClientPlayerResult } from '../../common/games/results.js'

export type GamesActions = DeliverLocalResults | GetGameRecord | GameUpdate

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

export interface GameUpdate {
  type: '@games/gameUpdate'
  payload: GameRecordUpdate
}
