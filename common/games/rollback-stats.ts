import { SbUserId } from '../users/sb-user-id'

/**
 * A rollback client's statistics for one game, cumulative from the end of the game's lockstep start
 * through `throughTurn`. Because every field is cumulative, any two snapshots of the same client's
 * stats can be differenced. Counts are u32 and durations are microseconds unless noted.
 *
 * Field names match the game process's rollback stats JSON (game/src/rollback_live.rs). Newer
 * clients may send additional fields, which are kept as-is.
 */
export interface RollbackStats {
  /** Layout version. */
  version: number
  /** The turn the stats run through. */
  throughTurn: number
  /** The client's rollback target setting, in frames. */
  rollbackTarget: number
  /** The client's prediction limit, in frames. */
  predictionLimit: number
  /** Game loop ticks counted. */
  ticks: number
  /**
   * Ticks by rollback shown (frames the shown frame was past the newest fully known turn). Index `i`
   * counts ticks that showed `i` frames, except the last index, which counts that many or more.
   */
  rollbackHistogram: number[]
  /**
   * Ticks by pipe depth (this client's own input delay, in turns). Index `i` counts ticks at `i`
   * turns, except the last index, which counts that many or more.
   */
  pipeHistogram: number[]
  /** Ticks stalled at the prediction limit. */
  cappedTicks: number
  /** Ticks that restored a snapshot. */
  rollbacks: number
  /** Frames simulated again. */
  resimulatedFrames: number
  /** Most frames one rollback simulated again. */
  deepestRollback: number
  /** Steps that first ran with at least one turn predicted. */
  predictedSteps: number
  /** Predicted turns a late turn contradicted. */
  mispredictedTurns: number
  /** Predicted turns that turned out right. */
  confirmedPredictions: number
  /** Extra frames stepped to catch up with the schedule. */
  caughtUpFrames: number
  /** Ticks whose next step was put off for being ahead of schedule. */
  heldBackTicks: number
  /** Times the controller moved the lead. */
  leadChanges: number
  /** Lead reports that moved the schedule. */
  scheduleCorrections: number
  /** Net effect of the schedule corrections (i64, negative = earlier). */
  scheduleCorrectedUs: number
  /** Stall holds undone because the stall was this client's alone. */
  holdsUndone: number
  /** The session clock's total stopped time. */
  clockStoppedUs: number
  /** Lead reports received. */
  leadReports: number
  /** The highest p90 lateness any lead report carried (i32). */
  leadP90MaxUs: number
  /** Sum of the lead reports' p90 lateness (i64); the mean is this over `leadReports`. */
  leadP90SumUs: number
  /** Longest non-stalled tick, start to end. */
  worstTickUs: number
  /** Non-stalled ticks over 4 ms. */
  slowTicks: number
  /** Total time restoring snapshots. */
  restoreUs: number
  /** Total time taking snapshots. */
  snapshotUs: number
  /** Total time in logic steps. */
  stepUs: number
}

/** The most entries a submitted rollback stats histogram may have. */
export const MAX_ROLLBACK_HISTOGRAM_ENTRIES = 64

/**
 * The body of a game client's rollback stats submission. Like a replay upload, it's authenticated
 * by the per-(game, user) result code rather than a session.
 */
export interface SubmitRollbackStatsRequest {
  /** The ID of the user submitting the stats. */
  userId: SbUserId
  /** The secret code the user was given to submit results with. */
  resultCode: string
  stats: RollbackStats
}
