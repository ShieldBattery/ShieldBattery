import { singleton } from 'tsyringe'
import transact from '../db/transaction'
import { JobScheduler } from '../jobs/job-scheduler'
import logger from '../logging/logger'
import {
  deferReplayViolationRecovery,
  findPendingReplayViolationGames,
  recordReplayViolation,
  ReplayViolation,
} from '../models/game-replay-violations'
import { lockGameAndCheckReconciled } from './game-models'
import { GamePointsRefundService } from './game-points-refund-service'

const RECOVERY_INTERVAL_MS = 30_000
const RECOVERY_BATCH_SIZE = 100

/** Persists result protection before enforcement and retries unfinished point restorations. */
@singleton()
export class ReplayViolationService {
  private recovery: Promise<void> | undefined

  constructor(
    private refunds: GamePointsRefundService,
    scheduler: JobScheduler,
  ) {
    scheduler.scheduleImmediateJob('games#replayViolationRefunds', RECOVERY_INTERVAL_MS, () =>
      this.recover(),
    )
  }

  async recordViolation(violation: ReplayViolation): Promise<void> {
    await transact(async client => {
      // Whether results are already final decides which path protects the players, not whether
      // the violation is recorded. Both paths serialize against this same game row.
      await lockGameAndCheckReconciled(client, violation.gameId)
      await recordReplayViolation(client, violation)
    })
    await this.refundGame(violation.gameId)
  }

  async recover(): Promise<void> {
    if (this.recovery) return this.recovery
    const recovery = this.recoverBatch()
    this.recovery = recovery
    try {
      await recovery
    } finally {
      this.recovery = undefined
    }
  }

  private async recoverBatch(): Promise<void> {
    const gameIds = await findPendingReplayViolationGames(RECOVERY_BATCH_SIZE)
    for (const gameId of gameIds) {
      await this.refundGame(gameId)
    }
  }

  private async refundGame(gameId: string): Promise<void> {
    try {
      await this.refunds.refundReplayViolation(gameId)
    } catch (err) {
      logger.error({ err, gameId }, 'Failed to restore game points after replay rejection')
      try {
        await deferReplayViolationRecovery(gameId)
      } catch (deferError) {
        logger.error({ err: deferError, gameId }, 'Failed to defer replay refund recovery')
      }
    }
  }
}
