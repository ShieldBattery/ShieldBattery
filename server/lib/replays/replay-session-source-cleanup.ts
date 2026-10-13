import { singleton } from 'tsyringe'
import { JobScheduler } from '../jobs/job-scheduler'
import { ReplaySessionSourceService } from './replay-session-source-service'

const JOB_RUN_INTERVAL_MS = 60 * 1000

/** Periodically removes expired staged replay files in bounded batches. */
@singleton()
export class ReplaySessionSourceCleanupJob {
  constructor(jobScheduler: JobScheduler, sourceService: ReplaySessionSourceService) {
    jobScheduler.scheduleImmediateJob(
      'lib/replays#replaySessionSourceCleanup',
      JOB_RUN_INTERVAL_MS,
      () => sourceService.removeExpiredSources(),
    )
  }
}
