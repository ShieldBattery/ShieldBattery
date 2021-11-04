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

export interface GameConfigPlayerId {
  id: SbUserId
  race: RaceChar
  isComputer: boolean
}

// TODO(tec27): Remove usages of this (use IDs instead), so we can reduce the amount of indirection
// and type explosion here
export interface GameConfigPlayerName {
  name: string
  race: RaceChar
  isComputer: boolean
}

interface BaseGameConfig<PlayerType, Source extends GameSource, SourceExtra> {
  gameSource: Source
  gameSourceExtra: SourceExtra
  gameType: GameType
  gameSubType: number
  teams: PlayerType[][]
}

export type LobbyGameConfig<PlayerType> = BaseGameConfig<PlayerType, GameSource.Lobby, undefined>

// TODO(tec27): Make SourceExtra an object with information about matchmaking type + arranged teams
export type MatchmakingGameConfig<PlayerType> = BaseGameConfig<
  PlayerType,
  GameSource.Matchmaking,
  MatchmakingType
>

export type GameConfig<PlayerType> = LobbyGameConfig<PlayerType> | MatchmakingGameConfig<PlayerType>

/** Returns the type of the `gameSourceExtra` param for a given `GameSource` type. */
export type GameSourceExtraType<Source extends GameSource> = (GameConfig<any> & {
  gameSource: Source
})['gameSourceExtra']
