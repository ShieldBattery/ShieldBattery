import { singleton } from 'tsyringe'
import { NetcodeV2RequestedRegion } from '../../../common/games/netcode-v2'
import { setNetcodeV2SessionMapping } from '../games/game-models'
import { JobScheduler } from '../jobs/job-scheduler'
import logger from '../logging/logger'
import { monotonicNow } from '../time/monotonic-now'

const RETRY_INTERVAL_MS = 5000
const RETENTION_MS = 15 * 60 * 1000
const MAX_PENDING = 512
const BATCH_SIZE = 16
const CONCURRENCY = 2

interface PendingMapping {
  gameId: string
  session: number
  requested: NetcodeV2RequestedRegion[]
  expiresAt: number
  retained: boolean
  inFlight?: Promise<void>
}

/** Bounded in-process repair of the authoritative session roster after a failed create-time write. */
@singleton()
export class EvidenceSessionMappingService {
  private pending = new Map<string, PendingMapping>()
  private retrying: Promise<void> | undefined

  constructor(jobScheduler: JobScheduler) {
    jobScheduler.scheduleImmediateJob(
      'lib/netcode-v2#repairSessionMappings',
      RETRY_INTERVAL_MS,
      () => this.retryPending(),
    )
  }

  /** Attempts the normal create-time write once; failures are repaired without delaying handoff. */
  async persist(
    gameId: string,
    session: number,
    requested: NetcodeV2RequestedRegion[],
  ): Promise<void> {
    const previous = this.pending.get(gameId)
    if (
      previous?.session === session &&
      JSON.stringify(previous.requested) === JSON.stringify(requested)
    ) {
      await (previous.inFlight ?? this.attempt(previous, true))
      return
    }

    const entry: PendingMapping = {
      gameId,
      session,
      requested: requested.map(slot => ({ ...slot })),
      expiresAt: monotonicNow() + RETENTION_MS,
      retained: !!previous || this.pending.size < MAX_PENDING,
    }
    if (entry.retained) {
      this.pending.set(gameId, entry)
    } else {
      logger.warn({ gameId }, 'Session mapping repair queue is full')
    }
    await this.attempt(entry, true, previous?.inFlight)
  }

  private attempt(
    entry: PendingMapping,
    logFailure: boolean,
    previous?: Promise<void>,
  ): Promise<void> {
    const attempt = (async () => {
      try {
        await previous
        // A newer create for this game owns the queued record. Serialize behind an in-flight
        // write so an older completion cannot replace the newer roster afterward.
        if (entry.retained && this.pending.get(entry.gameId) !== entry) return
        const stored = await setNetcodeV2SessionMapping(
          entry.gameId,
          entry.session,
          entry.requested,
        )
        if (!stored) logger.warn({ gameId: entry.gameId }, 'Session mapping was not accepted')
        if (this.pending.get(entry.gameId) === entry) this.pending.delete(entry.gameId)
      } catch (err) {
        if (logFailure)
          logger.warn({ err, gameId: entry.gameId }, 'Failed to persist session mapping')
      } finally {
        entry.inFlight = undefined
      }
    })()
    entry.inFlight = attempt
    return attempt
  }

  private async retryPending(): Promise<void> {
    if (this.retrying) return await this.retrying
    const retrying = this.retryBatch()
    this.retrying = retrying
    try {
      await retrying
    } finally {
      this.retrying = undefined
    }
  }

  private async retryBatch(): Promise<void> {
    const now = monotonicNow()
    const candidates: PendingMapping[] = []
    for (const entry of this.pending.values()) {
      if (entry.inFlight) continue
      if (entry.expiresAt <= now) {
        this.pending.delete(entry.gameId)
        logger.warn({ gameId: entry.gameId }, 'Session mapping repair expired')
      } else if (candidates.length < BATCH_SIZE) {
        candidates.push(entry)
      }
    }
    let next = 0
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        while (next < candidates.length) {
          const entry = candidates[next++]
          if (this.pending.get(entry.gameId) !== entry || entry.inFlight) continue
          // Rotate failed records so one unavailable subset cannot monopolize every batch.
          this.pending.delete(entry.gameId)
          this.pending.set(entry.gameId, entry)
          await this.attempt(entry, false)
        }
      }),
    )
  }
}
