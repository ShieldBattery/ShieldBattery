import { singleton } from 'tsyringe'
import { JobScheduler } from '../jobs/job-scheduler'
import logger from '../logging/logger'
import { Clock } from '../time/clock'
import { refreshMatchupStats } from './matchup-stats-models'

const JOB_RUN_INTERVAL_MS = 60 * 60 * 1000

/** Keeps the matchup stats tables up to date with the ranked games played. */
@singleton()
export class MatchupStatsJob {
  constructor(
    private jobScheduler: JobScheduler,
    private clock: Clock,
  ) {
    this.jobScheduler.scheduleImmediateJob(
      'lib/matchmaking#matchupStats',
      JOB_RUN_INTERVAL_MS,
      async () => {
        const result = await refreshMatchupStats(new Date(this.clock.now()))
        if (result?.full) {
          logger.info('Computed matchup stats for every season')
        }
      },
    )
  }
}
