import { TFunction } from 'i18next'
import { assertUnreachable } from '../assert-unreachable'

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

export function isValidGameSubType(type?: number): boolean {
  return type === undefined || (type >= 1 && type <= 7)
}

export function gameTypeToLabel(gameType: GameType, t: TFunction): string {
  switch (gameType) {
    case GameType.Melee:
      return t('game.gameType.melee', 'Melee')
    case GameType.FreeForAll:
      return t('game.gameType.freeForAll', 'Free for all')
    case GameType.TopVsBottom:
      return t('game.gameType.topVsBottom', 'Top vs bottom')
    case GameType.TeamMelee:
      return t('game.gameType.teamMelee', 'Team melee')
    case GameType.TeamFreeForAll:
      return t('game.gameType.teamFreeForAll', 'Team free for all')
    case GameType.UseMapSettings:
      return t('game.gameType.useMapSettings', 'Use map settings')
    case GameType.OneVsOne:
      return t('game.gameType.oneOnOne', 'One on one')
    default:
      return assertUnreachable(gameType)
  }
}
/**
 * Checks if the given `gameType` is a "team" type, meaning that a user can select the configuration
 * of the slots when creating a lobby, and the slots will be divided into different teams with
 * labels.
 */

export function isTeamType(gameType: GameType): boolean {
  switch (gameType) {
    case GameType.Melee:
      return false
    case GameType.FreeForAll:
      return false
    case GameType.OneVsOne:
      return false
    case GameType.UseMapSettings:
      return false
    case GameType.TeamMelee:
      return true
    case GameType.TeamFreeForAll:
      return true
    case GameType.TopVsBottom:
      return true
    default:
      return assertUnreachable(gameType)
  }
}
