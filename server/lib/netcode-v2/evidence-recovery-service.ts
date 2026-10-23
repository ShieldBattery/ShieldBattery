import { singleton } from 'tsyringe'
import { findNetcodeV2EvidenceRecoveryCandidates } from '../games/game-models'
import { JobScheduler } from '../jobs/job-scheduler'
import logger from '../logging/logger'
import { storeRecoveredEvidence } from './evidence-service'
import { loadConfigFromEnv } from './netcode-v2-config'
import { checkSessionsAlive, NetcodeV2Service } from './netcode-v2-service'

const RECOVERY_INTERVAL_MS = 30_000
const RECOVERY_WINDOW_MS = 6 * 60 * 60 * 1000
const PAGE_SIZE = 100
const CONCURRENCY = 4

/** Recovers missed observations while their coordinator sessions are still live. */
@singleton()
export class EvidenceRecoveryService {
  private readonly config = loadConfigFromEnv()
  private after: { gameId: string } | undefined
  private recovery: Promise<void> | undefined

  constructor(
    jobScheduler: JobScheduler,
    private netcodeService: NetcodeV2Service,
  ) {
    if (this.config) {
      jobScheduler.scheduleImmediateJob(
        'lib/netcode-v2#recoverEvidence',
        RECOVERY_INTERVAL_MS,
        async () => await this.recover(),
      )
    }
  }

  /** One bounded page; overlapping scheduler ticks join the same sweep. */
  async recover(): Promise<void> {
    if (!this.config) return
    if (this.recovery) return await this.recovery

    const recovery = this.recoverPage(this.config.tenant)
    this.recovery = recovery
    try {
      await recovery
    } finally {
      this.recovery = undefined
    }
  }

  private async recoverPage(tenant: string): Promise<void> {
    const candidates = await findNetcodeV2EvidenceRecoveryCandidates({
      since: new Date(Date.now() - RECOVERY_WINDOW_MS),
      after: this.after,
      limit: PAGE_SIZE,
    })
    if (!candidates.length) {
      this.after = undefined
      return
    }
    // Closed sessions retain no observations. One batch probe avoids individual empty reads
    // without using game age or result reconciliation as a proxy for coordinator liveness.
    const alive = await checkSessionsAlive(candidates.map(candidate => candidate.session))
    const liveCandidates = candidates.filter(candidate => alive.has(candidate.session))
    let next = 0
    let unsupported = false
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        while (!unsupported && next < liveCandidates.length) {
          const candidate = liveCandidates[next++]
          try {
            const evidence = await this.netcodeService.fetchSessionEvidence(candidate.session, {
              timeoutMs: 6000,
            })
            if (evidence === undefined) {
              unsupported = true
              return
            }
            if (evidence.length) {
              await storeRecoveredEvidence(
                { gameId: candidate.gameId, tenant, session: candidate.session },
                evidence,
              )
            }
          } catch (err) {
            logger.warn({ err, gameId: candidate.gameId }, 'Failed to recover coordinator evidence')
          }
        }
      }),
    )
    if (unsupported) return
    const last = candidates.at(-1)
    this.after = candidates.length === PAGE_SIZE && last ? { gameId: last.gameId } : undefined
  }
}
