import { container, singleton } from 'tsyringe'
import { SbUserId } from '../../../common/users/sb-user-id'
import { JobScheduler } from '../jobs/job-scheduler'
import logger from '../logging/logger'
import { MatchmakingBanService } from '../matchmaking/matchmaking-ban-service'
import { MatchmakingService } from '../matchmaking/matchmaking-service'
import {
  claimPendingGameLobbyViolations,
  MAX_RECOVERY_ATTEMPTS,
} from '../models/game-lobby-violations'
import { Clock } from '../time/clock'
import GameResultService from './game-result-service'

const LOCAL_RETRY_DELAY_MS = 5_000
const MAX_LOCAL_STAGE_ATTEMPTS = 3
const RECOVERY_BATCH_SIZE = 50
const RECOVERY_INTERVAL_MS = 60_000

interface LobbyViolationIntent {
  gameId: string
  userId: SbUserId
  detectedAt: Date
}

/**
 * The single owner of a matchmaking lobby-policy violation's consequences: it stages durable
 * evidence, then applies the offender's loss, their matchmaking ban, and the ban's effect on their
 * live queue state, and is the only thing that tells them about the penalty. The match the violation
 * cancelled only removes the offender from that match and requeues everyone else.
 */
@singleton()
export class LobbyViolationService {
  private static recoveryStarted = false

  static ensureRecoveryScheduled(jobScheduler: JobScheduler) {
    if (LobbyViolationService.recoveryStarted) return
    LobbyViolationService.recoveryStarted = true
    jobScheduler.scheduleImmediateJob(
      'lib/games#recoverLobbyViolations',
      RECOVERY_INTERVAL_MS,
      async () => await container.resolve(LobbyViolationService).recoverStagedViolations(),
    )
  }

  private recovery: Promise<void> | undefined
  private readonly processing = new Map<string, Promise<void>>()
  private readonly staging = new Map<string, Promise<boolean>>()
  private readonly stageRetryTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly stageAttempts = new Map<string, number>()

  constructor(
    jobScheduler: JobScheduler,
    private clock: Clock,
  ) {
    LobbyViolationService.ensureRecoveryScheduled(jobScheduler)
  }

  /** Stages durable evidence and starts effect processing without waiting for it. */
  async stage(gameId: string, userId: SbUserId, detectedAt: Date): Promise<boolean> {
    const existing = this.staging.get(gameId)
    if (existing) return await existing

    const retryTimer = this.stageRetryTimers.get(gameId)
    if (retryTimer) {
      clearTimeout(retryTimer)
      this.stageRetryTimers.delete(gameId)
    }

    const intent = { gameId, userId, detectedAt }
    const staged = (async () => {
      try {
        // Captured now because the offender's client may be gone by the time the ban is applied.
        // Someone who has already left matchmaking is still banned by account.
        const identifiers = container.resolve(MatchmakingService).currentIdentifiers(userId) ?? []
        const accepted = await container
          .resolve(GameResultService)
          .stageLobbyViolationIntent(gameId, userId, detectedAt, identifiers)
        this.stageAttempts.delete(gameId)
        if (accepted) {
          this.enqueueProcessing(gameId).catch(err => {
            logger.error({ err, gameId }, 'failed to process staged lobby violation')
          })
        }
        return accepted
      } catch (err) {
        this.scheduleStageRetry(intent)
        throw err
      }
    })()
    this.staging.set(gameId, staged)
    staged.then(
      () => this.clearStaging(gameId, staged),
      () => this.clearStaging(gameId, staged),
    )
    return await staged
  }

  /** Stages and waits for effects, for callers that need a completed penalty. */
  async record(gameId: string, userId: SbUserId, detectedAt: Date): Promise<void> {
    if (await this.stage(gameId, userId, detectedAt)) {
      await this.enqueueProcessing(gameId)
    }
  }

  /** Runs one bounded, leased batch of durable recovery work. */
  async recoverStagedViolations(): Promise<void> {
    if (this.recovery) return await this.recovery

    const recovery = this.runRecoveryBatch()
    this.recovery = recovery
    recovery.then(
      () => this.clearRecovery(recovery),
      () => this.clearRecovery(recovery),
    )
    return await recovery
  }

  private async runRecoveryBatch(): Promise<void> {
    const violations = await claimPendingGameLobbyViolations(
      RECOVERY_BATCH_SIZE,
      new Date(this.clock.now()),
    )
    for (const violation of violations) {
      try {
        await this.enqueueProcessing(violation.gameId)
      } catch (err) {
        if (violation.recoveryAttempts >= MAX_RECOVERY_ATTEMPTS) {
          logger.error(
            { err, gameId: violation.gameId, userId: violation.userId },
            'giving up on recovering staged lobby violation; its penalty needs manual review',
          )
        } else {
          logger.error(
            { err, gameId: violation.gameId },
            'failed to recover staged lobby violation',
          )
        }
      }
    }
  }

  private clearRecovery(recovery: Promise<void>) {
    if (this.recovery === recovery) this.recovery = undefined
  }

  private clearStaging(gameId: string, staged: Promise<boolean>) {
    if (this.staging.get(gameId) === staged) this.staging.delete(gameId)
  }

  private scheduleStageRetry(intent: LobbyViolationIntent) {
    const attempts = (this.stageAttempts.get(intent.gameId) ?? 0) + 1
    if (attempts >= MAX_LOCAL_STAGE_ATTEMPTS) {
      this.stageAttempts.delete(intent.gameId)
      logger.error(
        { gameId: intent.gameId, userId: intent.userId },
        'could not stage lobby violation after bounded local retries',
      )
      return
    }

    this.stageAttempts.set(intent.gameId, attempts)
    const existingTimer = this.stageRetryTimers.get(intent.gameId)
    if (existingTimer) clearTimeout(existingTimer)
    const timer = setTimeout(() => {
      this.stageRetryTimers.delete(intent.gameId)
      this.stage(intent.gameId, intent.userId, intent.detectedAt).catch(err => {
        logger.error({ err, gameId: intent.gameId }, 'failed to retry lobby violation staging')
      })
    }, LOCAL_RETRY_DELAY_MS)
    this.stageRetryTimers.set(intent.gameId, timer)
  }

  private enqueueProcessing(gameId: string): Promise<void> {
    const existing = this.processing.get(gameId)
    if (existing) return existing

    const processing = this.process(gameId)
    this.processing.set(gameId, processing)
    processing.then(
      () => this.clearProcessing(gameId, processing),
      () => this.clearProcessing(gameId, processing),
    )
    return processing
  }

  private clearProcessing(gameId: string, processing: Promise<void>) {
    if (this.processing.get(gameId) === processing) this.processing.delete(gameId)
  }

  private async process(gameId: string): Promise<void> {
    const result = await container
      .resolve(GameResultService)
      .applyStagedLobbyViolationEffects(gameId)
    if (!result) return

    const banService = container.resolve(MatchmakingBanService)
    const penalty = await banService.applyGamePenalty(result.userId, result.identifiers, gameId)
    if (!penalty.needsEnforcement) return

    await container.resolve(MatchmakingService).enforceLobbyViolationPenalty({
      gameId,
      userId: result.userId,
      penalty: penalty.penalty,
    })
    await banService.acknowledgeGamePenaltyEnforced(gameId, result.userId)
  }
}
