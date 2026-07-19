import { TFunction } from 'i18next'
import { assertUnreachable } from '../assert-unreachable'
import { AssignedRaceChar } from '../races'
import { SbUserId } from '../users/sb-user-id'

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

export function getResultLabel(
  result: ReconciledResult,
  t: TFunction,
  alternativeUnknown?: boolean,
): string {
  if (result === 'win') {
    return t('game.results.win', 'Win')
  } else if (result === 'loss') {
    return t('game.results.loss', 'Loss')
  } else if (result === 'draw') {
    return t('game.results.draw', 'Draw')
  } else if (result === 'unknown') {
    return alternativeUnknown ? '—' : t('game.results.unknown', 'Unknown')
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
  /** The game has not been marked as loaded yet, so results cannot be submitted. */
  NotLoaded = 'NotLoaded',
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

/**
 * The alliance relationship a player declares toward another player, using the same raw numeric
 * values StarCraft reports in its per-player alliance table.
 */
export enum GameClientAllianceState {
  Unallied = 0,
  Allied = 1,
  AlliedVictory = 2,
}

export const ALL_GAME_CLIENT_ALLIANCE_STATES: ReadonlyArray<GameClientAllianceState> = [
  GameClientAllianceState.Unallied,
  GameClientAllianceState.Allied,
  GameClientAllianceState.AlliedVictory,
]

/**
 * The kind of loss the local (reporting) player received, if any, describing how their connection
 * to the game ended. Used by results derivation to decide whether a local disconnect looks like a
 * targeted drop or a mass disconnect (where the reporter is more likely at fault).
 */
export type GameClientLoseType = 'targetedDisconnect' | 'massDisconnect'

export const ALL_GAME_CLIENT_LOSE_TYPES: ReadonlyArray<GameClientLoseType> = [
  'targetedDisconnect',
  'massDisconnect',
]

/**
 * One player's raw end-of-game evidence, exactly as captured from StarCraft by the reporting game
 * client. This is the pre-digest form: the server derives the per-player verdicts from these.
 */
export interface RawPlayerResult {
  /** The player's user ID, or `null` for a computer player. */
  userId: SbUserId | null
  /** The player's index in StarCraft's `players` array (0-7). */
  bwPlayerId: number
  /** The player's storm (networking) id (0-7), or `null` for a computer player. */
  stormId: number | null
  race: AssignedRaceChar
  /** The raw StarCraft victory state (shares numeric values with `GameClientResult`). */
  victoryState: GameClientResult
  /** The raw alliance state toward each of the 8 BW player slots (exactly 8 entries). */
  alliances: GameClientAllianceState[]
}

/** The final network status of one storm slot, as observed by the reporting client. */
export interface RawNetPlayer {
  stormId: number
  /** Whether this slot was dropped for any reason (checksum mismatch, lag, etc). */
  wasDropped: boolean
  /** Whether this slot left the game voluntarily. */
  hasQuit: boolean
}

/**
 * The raw end-of-game report a modern game client submits, reaching the server via the netcode-v2
 * relay's signed webhook. Unlike the legacy `SubmitGameResultsRequest`, this carries the undigested
 * BW evidence and the server derives the per-player verdicts from it. Legacy reports are
 * distinguished by the absence of `version`.
 */
export interface RawGameResultsReport {
  /** Marks this as a raw (v2) report; absent on legacy digested reports. */
  version: 2
  /** The ID of the user submitting results. */
  userId: SbUserId
  /** The secret code the user was given to submit results with. */
  resultCode: string
  /** The elapsed time of the game, in milliseconds. */
  time: number
  /** Every non-observer human (with a BW player id) plus every computer player (≤8 rows). */
  players: RawPlayerResult[]
  /** The reporting client's view of each storm slot's final network status (≤8 rows). */
  netPlayers: RawNetPlayer[]
  /** How the local (reporting) player lost, if applicable. */
  localPlayerLoseType: GameClientLoseType | null
}

/** The stored form of a raw report (the wire report minus `userId`/`resultCode`). */
export interface StoredRawGameResults {
  version: 2
  time: number
  players: RawPlayerResult[]
  netPlayers: RawNetPlayer[]
  localPlayerLoseType: GameClientLoseType | null
}

/** The stored form of a legacy digested report. */
export interface StoredLegacyGameResults {
  time: number
  playerResults: Array<[SbUserId, GameClientPlayerResult]>
}

/**
 * What a game user's `reported_results` jsonb can hold: either a legacy digested report or a raw
 * (v2) report. The two are distinguished by the presence of `version`.
 */
export type StoredGameResults = StoredLegacyGameResults | StoredRawGameResults

/** Whether a stored report is the raw (v2) form rather than the legacy digested form. */
export function isRawStoredGameResults(stored: StoredGameResults): stored is StoredRawGameResults {
  return 'version' in stored
}

export interface SubmitGameReplayRequest {
  /** The ID of the user submitting the replay. */
  userId: SbUserId
  /** The secret code the user was given to submit results with. */
  resultCode: string
  // NOTE(tec27): This request must also contain `replay`, but this is a file that will be accessed
  // separately
}
