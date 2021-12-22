import { SbUserId } from './sb-user'

/**
 * Aggregate statistics for a particular user. Contains wins and losses for particular race
 * selections in non-UMS games.
 */
export interface UserStats {
  userId: SbUserId

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
