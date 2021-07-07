import { Jsonify } from '../json'
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
  results: [number, ReconciledPlayerResult][] | null
}

export type GameRecordJson = Jsonify<GameRecord>
