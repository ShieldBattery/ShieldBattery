import { RaceStats } from '../races'
import { SbUserId } from './sb-user'

/**
 * Aggregate statistics for a particular user. Contains wins and losses for particular race
 * selections in non-UMS games.
 */
export interface UserStats extends RaceStats {
  userId: SbUserId
}
