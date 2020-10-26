import { RaceChar } from '../../../common/races'

export type GameSource = 'MATCHMAKING' | 'LOBBY'

// TODO(tec27): These game types should be in a more common place
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
