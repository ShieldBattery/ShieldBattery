import { singleton } from 'tsyringe'
import { JobScheduler } from '../jobs/job-scheduler'
import logger from '../logging/logger'
import { finalizeSeasonRankings, findUnfinalizedSeasons } from '../matchmaking/models'
import { Clock } from '../time/clock'

const JOB_RUN_INTERVAL_MINUTES = 60 * 3 // 3 hours

@singleton()
export class FinalizeRankingsJob {
  constructor(
    private jobScheduler: JobScheduler,
    private clock: Clock,
  ) {
    const startTime = new Date(this.clock.now())
    const jitter = (Math.random() * JOB_RUN_INTERVAL_MINUTES) / 2 - JOB_RUN_INTERVAL_MINUTES / 4
    startTime.setMinutes(startTime.getMinutes() + JOB_RUN_INTERVAL_MINUTES + jitter)

    this.jobScheduler.scheduleJob(
      'lib/ladder#finalizeRankings',
      startTime,
      JOB_RUN_INTERVAL_MINUTES * 60 * 1000,
      async () => {
        const unfinalizedSeasons = await findUnfinalizedSeasons()
        for (const season of unfinalizedSeasons) {
          logger.info(`Finalizing rankings for season ${season.id}`)
          await finalizeSeasonRankings(season.id)
          logger.info(`Ranks for season ${season.id} finalized.`)
        }
      },
    )
  }
}
