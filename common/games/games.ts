import { Jsonify } from '../json'
import { SbUserId } from '../users/user-info'
import { GameConfig, GameConfigPlayerId } from './configuration'
import { ReconciledPlayerResult } from './results'

export interface GameRecord {
  id: string
  startTime: Date
  mapId: string
  config: GameConfig<GameConfigPlayerId>
  disputable: boolean
  disputeRequested: boolean
  disputeReviewed: boolean
  gameLength: number | null
  results: [SbUserId, ReconciledPlayerResult][] | null
}

export type GameRecordJson = Jsonify<GameRecord>
