import { Immutable } from 'immer'
import { assertUnreachable } from '../assert-unreachable'
import { Jsonify } from '../json'
import { MapInfoJson } from '../maps'
import { SbUser, SbUserId } from '../users/user-info'
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

export function toGameRecordJson(game: GameRecord): GameRecordJson {
  return {
    id: game.id,
    startTime: Number(game.startTime),
    mapId: game.mapId,
    config: game.config,
    disputable: game.disputable,
    disputeRequested: game.disputeRequested,
    disputeReviewed: game.disputeReviewed,
    gameLength: game.gameLength,
    results: game.results,
  }
}

export function getGameTypeLabel(game: Immutable<GameRecordJson>): string {
  // TODO(tec27): Handle more ranked types, show mode (UMS, Top v Bottom, etc.?)
  if (game.config.gameSource === 'LOBBY') {
    return 'Custom game'
  } else if (game.config.gameSource === 'MATCHMAKING') {
    return 'Ranked 1v1'
  }

  return assertUnreachable(game.config.gameSource)
}

export interface GetGamePayload {
  game: GameRecordJson
  map: MapInfoJson
  users: SbUser[]
}
