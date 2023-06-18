import { TFunction } from 'i18next'
import { assertUnreachable } from './assert-unreachable'

/** A single-character representation of a chosen StarCraft race. */
export type RaceChar = 'p' | 'r' | 't' | 'z'

/**
 * A single-character representation of a StarCraft race after any Random races have been assigned.
 */
export type AssignedRaceChar = 'p' | 't' | 'z'

/**
 * A type representing all possible combinations we care about with regards to race statistics. The
 * values at the bottom refer to races that were assigned when the player had "random" selected as
 * their race.
 */
export interface RaceStats {
  pWins: number
  pLosses: number
  tWins: number
  tLosses: number
  zWins: number
  zLosses: number
  rWins: number
  rLosses: number

  rPWins: number
  rPLosses: number
  rTWins: number
  rTLosses: number
  rZWins: number
  rZLosses: number
}

export function raceCharToLabel(raceChar: RaceChar, t: TFunction): string {
  switch (raceChar) {
    case 'p':
      return t('game.race.protoss', 'Protoss')
    case 'r':
      return t('game.race.random', 'Random')
    case 't':
      return t('game.race.terran', 'Terran')
    case 'z':
      return t('game.race.zerg', 'Zerg')
    default:
      return assertUnreachable(raceChar)
  }
}
