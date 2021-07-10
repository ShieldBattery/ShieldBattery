import { singleton } from 'tsyringe'
import logger from '../logging/logger'
import { monotonicNow } from '../time/monotonic-now'

interface JobInfo {
  jobId: string
  startTime: Date
  runEveryMs: number
  jobFn: () => Promise<void>

  currentTimeout: ReturnType<typeof setTimeout>
}

/**
 * A utility service for scheduling jobs that run periodically. Jobs should have a unique ID for
 * the type of job they are (including the filepath usually makes this easy to achieve). Any jobs
 * scheduled when the server crashes or shuts down will be lost, so if you need them to be restored,
 * you need to implement that behavior yourself.
 */
@singleton()
export class JobScheduler {
  private jobs = new Map<string, JobInfo>()

  /**
   * Schedules a job to run. If a job has already been scheduled with that ID, it will be replaced
   * by this one.
   *
   * @param jobId a string that uniquely identifies this particular job
   * @param startTime a Date at which the first run of this job should occur
   * @param runEveryMs how many milliseconds should pass before the job reruns. A value of -1 can
   *   be used to indicate it should be unscheduled after the first run
   * @param jobFn A function that will be called when the job runs, which should perform its duties
   */
  scheduleJob(jobId: string, startTime: Date, runEveryMs: number, jobFn: () => Promise<void>) {
    if (this.jobs.has(jobId)) {
      this.unscheduleJob(jobId)
    }

    let firstTimeout = Number(startTime) - Date.now()
    if (firstTimeout < 0) {
      logger.warning(`startTime for job ${jobId} was not in the future`)
      firstTimeout = 0
    }

    const currentTimeout = setTimeout(() => this.runJob(jobId), firstTimeout)
    this.jobs.set(jobId, { jobId, startTime, runEveryMs, jobFn, currentTimeout })
    logger.info(`Scheduled ${jobId} to run every ${runEveryMs}ms starting at ${startTime}`)
  }

  /**
   * Unschedules a previously scheduled job. If the job is currently running, that run will be
   * allowed to complete.
   *
   * @returns true of the job was scheduled, false otherwise
   */
  unscheduleJob(jobId: string): boolean {
    if (!this.jobs.has(jobId)) {
      return false
    }

    const job = this.jobs.get(jobId)!
    this.jobs.delete(jobId)
    clearTimeout(job.currentTimeout)
    return true
  }

  private runJob(jobId: string) {
    if (!this.jobs.has(jobId)) {
      logger.warning(`Woke to run job ${jobId} but it wasn't found in the schedule`)
    }

    const job = this.jobs.get(jobId)!
    if (job.runEveryMs >= 0) {
      job.currentTimeout = setTimeout(() => this.runJob(jobId), job.runEveryMs)
    } else {
      this.unscheduleJob(jobId)
    }

    logger.info(`Running job ${jobId}`)
    const startTime = monotonicNow()
    job.jobFn().then(
      () => {
        const completionTime = monotonicNow()
        logger.info(`Job ${jobId} completed in ${completionTime - startTime}ms`)
      },
      err => {
        logger.error(`Error while running ${jobId}: ${err.message}\n${err.stack ?? err}`)
      },
    )
  }
}
