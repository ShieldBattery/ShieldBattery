import { singleton } from 'tsyringe'
import { urlPath } from '../../../common/urls'
import { SbUserId } from '../../../common/users/sb-user-id'
import { DiscordWebhookNotifier } from '../discord/webhook-notifier'
import { JobScheduler } from '../jobs/job-scheduler'
import logger from '../logging/logger'
import { Clock } from '../time/clock'
import { BanEnacter } from './ban-enacter'
import { banEvasionEndTime } from './ban-evasion'
import { MIN_IDENTIFIER_MATCHES } from './client-ids'
import {
  findPendingIdentifierReconciliations,
  finishIdentifierBan,
  finishIdentifierReconciliation,
  getGameIdentifiers,
  IdentifierObservation,
  pruneIdentifierObservations,
  recordIdentifierObservation,
  retryIdentifierReconciliation,
  scheduleIdentifierBan,
  withIdentifierReconciliation,
} from './identifier-observation-models'
import { RestrictionService } from './restriction-service'
import { countBannedUserIdentifiers } from './user-identifiers'
import { findUserById } from './user-model'

const BATCH_SIZE = 16
const MAX_USERS_PER_TICK = 128
const TICK_BUDGET_MS = 5_000

@singleton()
export class IdentifierReconciliationService {
  private running = false
  private pruning = false

  constructor(
    private restrictionService: RestrictionService,
    private banEnacter: BanEnacter,
    private clock: Clock,
    jobs: JobScheduler,
    private discordNotifier: DiscordWebhookNotifier,
  ) {
    jobs.scheduleImmediateJob('users/reconcile-identifiers', 15_000, () => this.reconcile())
    jobs.scheduleImmediateJob('users/prune-identifier-observations', 60 * 60 * 1000, () =>
      this.prune(),
    )
  }

  async prune(): Promise<void> {
    if (this.pruning) return
    this.pruning = true
    try {
      const deadline = this.clock.monotonicNow() + TICK_BUDGET_MS
      for (let batch = 0; batch < 32 && this.clock.monotonicNow() < deadline; batch++) {
        const result = await pruneIdentifierObservations()
        if (result.observations < 1000 && result.reconciliations < 1000) break
      }
    } finally {
      this.pruning = false
    }
  }

  async observe(observation: IdentifierObservation): Promise<void> {
    await recordIdentifierObservation(observation)
  }

  async reconcile(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      const deadline = this.clock.monotonicNow() + TICK_BUDGET_MS
      const attempted = new Set<SbUserId>()
      while (attempted.size < MAX_USERS_PER_TICK && this.clock.monotonicNow() < deadline) {
        const batch = await findPendingIdentifierReconciliations(
          [...attempted],
          Math.min(BATCH_SIZE, MAX_USERS_PER_TICK - attempted.size),
        )
        if (!batch.length) break
        for (const pending of batch) {
          if (this.clock.monotonicNow() >= deadline) break
          // A locked account is left to its current worker; don't keep selecting it this tick.
          if (attempted.has(pending.userId)) continue
          attempted.add(pending.userId)
          await withIdentifierReconciliation(
            pending.userId,
            pending.gameId,
            async (work, client) => {
              try {
                if (work.revision !== work.processedRevision) {
                  // Reconcile all game IDs: a prior attempt may have committed them before crashing.
                  await this.restrictionService.handleNewIdentifiers(
                    work.userId,
                    await getGameIdentifiers(work.userId, client),
                  )
                  const alreadyBanned = await this.banEnacter.mirrorActiveBanIdentifiers(
                    work.userId,
                  )
                  if (work.actionState === 'idle') {
                    if (alreadyBanned) {
                      await finishIdentifierBan(work, 'done', client)
                    } else {
                      const [count, latestEnd] = await countBannedUserIdentifiers(
                        work.userId,
                        client,
                      )
                      if (count >= MIN_IDENTIFIER_MATCHES && latestEnd) {
                        const now = this.clock.now()
                        await scheduleIdentifierBan(work, banEvasionEndTime(now, latestEnd), client)
                      }
                    }
                  }
                  await finishIdentifierReconciliation(work, client)
                }

                if (
                  work.actionState === 'pending' &&
                  work.notBefore &&
                  Number(work.notBefore) <= this.clock.now() &&
                  work.endTime
                ) {
                  const result = await this.banEnacter.enactIdentifierBanRequest(
                    {
                      requestId: work.requestId,
                      targetId: work.userId,
                      endTime: work.endTime,
                      reason: 'ban evasion',
                    },
                    work.gameId,
                  )
                  if (result.status === 'banned') {
                    const user = await findUserById(work.userId, client)
                    if (user) {
                      // Delivery is at least once: retrying a notification never reapplies the ban.
                      await this.discordNotifier.notify({
                        content:
                          `User '${user.name}' [${user.id}] banned for ban evasion.\n` +
                          `${process.env.SB_CANONICAL_HOST}${urlPath`/users/${user.id}/${user.name}/`}\n` +
                          `${process.env.SB_CANONICAL_HOST}${urlPath`/games/${work.gameId}`}`,
                      })
                    }
                  }
                  await finishIdentifierBan(
                    work,
                    result.status === 'notNeeded' ? 'idle' : 'done',
                    client,
                  )
                }
              } catch (err) {
                await retryIdentifierReconciliation(work, client)
                logger.error(
                  { err, userId: work.userId, gameId: work.gameId },
                  'Identifier reconciliation failed',
                )
              }
            },
          )
        }
      }
    } finally {
      this.running = false
    }
  }
}
