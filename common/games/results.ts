import { TFunction } from 'i18next'
import { Merge } from 'type-fest'
import { assertUnreachable } from '../assert-unreachable'
import { AssignedRaceChar } from '../races'
import { SbUserId } from '../users/sb-user'

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

export const ALL_GAME_CLIENT_RESULTS: ReadonlyArray<GameClientResult> = [
  GameClientResult.Playing,
  GameClientResult.Disconnected,
  GameClientResult.Defeat,
  GameClientResult.Victory,
]

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

export function getResultLabel(result: ReconciledResult, t: TFunction): string {
  if (result === 'win') {
    return t('game.results.win', 'Win')
  } else if (result === 'loss') {
    return t('game.results.loss', 'Loss')
  } else if (result === 'draw') {
    return t('game.results.draw', 'Draw')
  } else if (result === 'unknown') {
    return t('game.results.unknown', 'Unknown')
  }

  return assertUnreachable(result)
}

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

/** Error codes that can result from submitting or accessing game results. */
export enum GameResultErrorCode {
  /** The specified game record could not be found. */
  NotFound = 'NotFound',
  /** Results have already been reported for this game. */
  AlreadyReported = 'AlreadyReported',
  /** The reported results contain one or more invalid players. */
  InvalidPlayers = 'InvalidPlayers',
  /** The specified client could not be found or wasn't valid for this request. */
  InvalidClient = 'InvalidClient',
}

/** The payload format for submitting game results to the server. */
export interface SubmitGameResultsRequest {
  /** The ID of the user submitting results. */
  userId: SbUserId
  /** The secret code the user was given to submit results with. */
  resultCode: string
  /** The elapsed time of the game, in milliseconds. */
  time: number
  /** Each player's result. */
  playerResults: [playerId: SbUserId, result: GameClientPlayerResult][]
}

// TODO(tec27): Delete once the game code calls the new endpoint
export type LegacySubmitGameResultsRequest = Merge<
  SubmitGameResultsRequest,
  { playerResults: [playerName: string, result: GameClientPlayerResult][] }
>
