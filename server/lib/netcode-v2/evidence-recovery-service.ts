import { singleton } from 'tsyringe'
import { findNetcodeV2EvidenceRecoveryCandidates } from '../games/game-models'
import { JobScheduler } from '../jobs/job-scheduler'
import logger from '../logging/logger'
import { storeRecoveredEvidence } from './evidence-service'
import { loadConfigFromEnv } from './netcode-v2-config'
import { NetcodeV2Service } from './netcode-v2-service'

const RECOVERY_INTERVAL_MS = 30_000
const RECOVERY_WINDOW_MS = 6 * 60 * 60 * 1000
const PAGE_SIZE = 100
const CONCURRENCY = 4

/** Recovers observations whose webhook delivery was missed, without affecting game setup. */
@singleton()
export class EvidenceRecoveryService {
  private readonly config = loadConfigFromEnv()
  private after: { gameId: string } | undefined
  private recovery: Promise<void> | undefined

  constructor(
    jobScheduler: JobScheduler,
    private netcodeService: NetcodeV2Service,
  ) {
    if (this.config?.evidenceKeys?.length) {
      jobScheduler.scheduleImmediateJob(
        'lib/netcode-v2#recoverEvidence',
        RECOVERY_INTERVAL_MS,
        async () => await this.recover(),
      )
    }
  }

  /** One bounded page; overlapping scheduler ticks join the same sweep. */
  async recover(): Promise<void> {
    if (!this.config?.evidenceKeys?.length) return
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
    let next = 0
    let unsupported = false
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        while (!unsupported && next < candidates.length) {
          const candidate = candidates[next++]
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
