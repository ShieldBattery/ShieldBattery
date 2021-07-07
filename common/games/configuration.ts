import { RaceChar } from '../races'

export type GameSource = 'MATCHMAKING' | 'LOBBY'

export interface GameConfigPlayerId {
  id: number
  race: RaceChar
  isComputer: boolean
}

export interface GameConfigPlayerName {
  name: string
  race: RaceChar
  isComputer: boolean
}

export interface GameConfig<PlayerType> {
  gameType: string // TODO(tec27): this could be more limiting/specific
  gameSubType: number
  gameSource: GameSource
  /** Extra information about the game source, e.g. the matchmaking type */
  gameSourceExtra?: string
  teams: PlayerType[][]
}
