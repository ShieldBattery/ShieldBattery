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
  host?: SbUserId
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

export interface MatchmakingExtra2v2Bgh {
  type: MatchmakingType.Match2v2Bgh
}

export interface MatchmakingExtra2v2Hunters {
  type: MatchmakingType.Match2v2Hunters
}

export interface MatchmakingExtra2v2Fastest {
  type: MatchmakingType.Match2v2Fastest
}

export interface MatchmakingExtra3v3Bgh {
  type: MatchmakingType.Match3v3Bgh
}

export interface MatchmakingExtra3v3Hunters {
  type: MatchmakingType.Match3v3Hunters
}

export interface MatchmakingExtra3v3Fastest {
  type: MatchmakingType.Match3v3Fastest
}

export type MatchmakingExtra =
  | MatchmakingExtra1v1
  | MatchmakingExtra1v1Fastest
  | MatchmakingExtra2v2
  | MatchmakingExtra2v2Bgh
  | MatchmakingExtra2v2Hunters
  | MatchmakingExtra2v2Fastest
  | MatchmakingExtra3v3Bgh
  | MatchmakingExtra3v3Hunters
  | MatchmakingExtra3v3Fastest

export type MatchmakingGameConfig = BaseGameConfig<GameSource.Matchmaking, MatchmakingExtra>

export type GameConfig = LobbyGameConfig | MatchmakingGameConfig

/** Returns the type of the `gameSourceExtra` param for a given `GameSource` type. */
export type GameSourceExtraType<Source extends GameSource> = (GameConfig & {
  gameSource: Source
})['gameSourceExtra']
