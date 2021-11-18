import { SetOptional } from 'type-fest'
import { assertUnreachable } from '../assert-unreachable'
import { MatchmakingType } from '../matchmaking'
import { RaceChar } from '../races'
import { SbUserId } from '../users/user-info'

export enum GameSource {
  Lobby = 'LOBBY',
  Matchmaking = 'MATCHMAKING',
}

export const ALL_GAME_SOURCES: ReadonlyArray<GameSource> = Object.values(GameSource)

export enum GameType {
  Melee = 'melee',
  FreeForAll = 'ffa',
  OneVsOne = 'oneVOne',
  TopVsBottom = 'topVBottom',
  TeamMelee = 'teamMelee',
  TeamFreeForAll = 'teamFfa',
  UseMapSettings = 'ums',
}
export const ALL_GAME_TYPES: ReadonlyArray<GameType> = Object.values(GameType)

export function isValidGameType(type: string): boolean {
  return ALL_GAME_TYPES.includes(type as GameType)
}

export function isValidGameSubType(type?: number | null): boolean {
  return type === null || type === undefined || (type >= 1 && type <= 7)
}

export function gameTypeToLabel(gameType: GameType): string {
  switch (gameType) {
    case GameType.Melee:
      return 'Melee'
    case GameType.FreeForAll:
      return 'Free for all'
    case GameType.TopVsBottom:
      return 'Top vs bottom'
    case GameType.TeamMelee:
      return 'Team melee'
    case GameType.TeamFreeForAll:
      return 'Team free for all'
    case GameType.UseMapSettings:
      return 'Use map settings'
    case GameType.OneVsOne:
      return 'One on one'
    default:
      return assertUnreachable(gameType)
  }
}

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
  BaseGameConfig<GameSource.Lobby, undefined>,
  'gameSourceExtra'
>

export interface MatchmakingExtra1v1 {
  type: MatchmakingType.Match1v1
}

export interface MatchmakingExtra2v2 {
  type: MatchmakingType.Match2v2
  /**
   * The user IDs of players in the match, grouped into lists by party. Players not in a party
   * will be in a list by themselves.
   */
  parties: SbUserId[][]
}

export type MatchmakingExtra = MatchmakingExtra1v1 | MatchmakingExtra2v2

export type MatchmakingGameConfig = BaseGameConfig<GameSource.Matchmaking, MatchmakingExtra>

export type GameConfig = LobbyGameConfig | MatchmakingGameConfig

/** Returns the type of the `gameSourceExtra` param for a given `GameSource` type. */
export type GameSourceExtraType<Source extends GameSource> = (GameConfig & {
  gameSource: Source
})['gameSourceExtra']
