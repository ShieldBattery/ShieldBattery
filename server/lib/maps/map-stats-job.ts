import { singleton } from 'tsyringe'
import { JobScheduler } from '../jobs/job-scheduler'
import logger from '../logging/logger'
import { Clock } from '../time/clock'
import { refreshMapStats } from './map-stats-models'

const JOB_RUN_INTERVAL_MS = 60 * 60 * 1000

/** Keeps the map stats tables up to date with the games played on each map. */
@singleton()
export class MapStatsJob {
  constructor(
    private jobScheduler: JobScheduler,
    private clock: Clock,
  ) {
    this.jobScheduler.scheduleImmediateJob('lib/maps#mapStats', JOB_RUN_INTERVAL_MS, async () => {
      const result = await refreshMapStats(new Date(this.clock.now()))
      if (result?.full) {
        logger.info('Computed map stats for all games')
      }
    })
  }
}
