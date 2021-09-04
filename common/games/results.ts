import { AssignedRaceChar } from '../races'
import { SbUserId } from '../users/user-info'

/**
 * The results of a game, as reported by the game client. These results have not yet been reconciled
 * across all players, so they may still contain "in-progress"-type results.
 */
export enum GameClientResult {
  Playing = 0,
  Disconnected = 1,
  Defeat = 2,
  Victory = 3,
}

/**
 * The results of a game for a particular player.
 */
export interface GameClientPlayerResult {
  result: GameClientResult
  race: AssignedRaceChar
  apm: number
}

/**
 * The final, reconciled results of a game, after all players' results have been combined.
 */
export type ReconciledResult = 'win' | 'loss' | 'draw' | 'unknown'

export interface ReconciledPlayerResult {
  result: ReconciledResult
  race: AssignedRaceChar
  apm: number
}

export interface ReconciledResults {
  /**
   * Whether or not some of the players' results disagree on outcomes. Disputed results should
   * be looked over by an administrator to ensure correctness and that no cheating is occurring.
   */
  disputed: boolean
  /** The elapsed time for the game, in milliseconds. */
  time: number
  /** A map containing the final result info for each player in the game. */
  results: Map<SbUserId, ReconciledPlayerResult>
}
