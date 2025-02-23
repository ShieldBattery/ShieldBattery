import { SetOptional } from 'type-fest'
import { MatchmakingType } from '../matchmaking'
import { BwTurnRate } from '../network'
import { RaceChar } from '../races'
import { SbUserId } from '../users/sb-user-id'
import { GameType } from './game-type'

export enum GameSource {
  Lobby = 'LOBBY',
  Matchmaking = 'MATCHMAKING',
}

export const ALL_GAME_SOURCES: ReadonlyArray<GameSource> = Object.values(GameSource)

export interface GameConfigPlayer {
  id: SbUserId
  race: RaceChar
  isComputer: boolean
}

interface BaseGameConfig<Source extends GameSource, SourceExtra> {
  gameSource: Source
  gameSourceExtra: SourceExtra
  gameType: GameType
  gameSubType: number
  teams: GameConfigPlayer[][]
}

export type LobbyGameConfig = SetOptional<
  BaseGameConfig<GameSource.Lobby, LobbyExtra>,
  'gameSourceExtra'
>

export interface LobbyExtra {
  turnRate?: BwTurnRate | 0
  useLegacyLimits?: boolean
}

export interface MatchmakingExtra1v1 {
  type: MatchmakingType.Match1v1
}

export interface MatchmakingExtra1v1Fastest {
  type: MatchmakingType.Match1v1Fastest
}

export interface MatchmakingExtra2v2 {
  type: MatchmakingType.Match2v2
  /**
   * The user IDs of players in the match, grouped into lists by party. Players not in a party
   * will be in a list by themselves.
   */
  parties: SbUserId[][]
}

export type MatchmakingExtra =
  | MatchmakingExtra1v1
  | MatchmakingExtra1v1Fastest
  | MatchmakingExtra2v2

export type MatchmakingGameConfig = BaseGameConfig<GameSource.Matchmaking, MatchmakingExtra>

export type GameConfig = LobbyGameConfig | MatchmakingGameConfig

/** Returns the type of the `gameSourceExtra` param for a given `GameSource` type. */
export type GameSourceExtraType<Source extends GameSource> = (GameConfig & {
  gameSource: Source
})['gameSourceExtra']
