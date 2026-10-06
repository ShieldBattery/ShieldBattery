import { exponentialBuckets, Histogram } from '@prometheus-io/client'
import { singleton } from 'tsyringe'
import logger from '../logging/logger'
import { Clock } from '../time/clock'
import { monotonicNow } from '../time/monotonic-now'

/**
 * The longest delay `setTimeout` supports. Longer delays overflow and fire immediately, so waits
 * longer than this are split into multiple timeouts.
 */
const MAX_TIMEOUT_MS = 2 ** 31 - 1

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
  private runtimeMetric = new Histogram({
    labelNames: ['jobId'],
    name: 'shieldbattery_job_runtime_seconds',
    help: 'Duration of job runtime in seconds',
    buckets: exponentialBuckets(0.01, 1.4, 20),
  })

  constructor(private clock: Clock) {}

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

    if (Number(startTime) < this.clock.now()) {
      logger.warn(`startTime for job ${jobId} was not in the future`)
    }

    const currentTimeout = this.setFirstRunTimeout(jobId, startTime)
    this.jobs.set(jobId, { jobId, startTime, runEveryMs, jobFn, currentTimeout })
    logger.info(
      `Scheduled ${jobId} to run every ${runEveryMs}ms starting at ${startTime.toISOString()}`,
    )
  }

  /**
   * Schedules a job to run immediately, adding a random amount of delay to the start time to avoid
   * having all the jobs run at the same time. Any jobs scheduled this way will be run immediately
   * after the jitter period has passed. The jitter period will depend on how often the job is
   * scheduled to run.
   */
  scheduleImmediateJob(jobId: string, runEveryMs: number, jobFn: () => Promise<void>) {
    const jitterMin = Math.min(5000, runEveryMs / 20)
    const jitterMax = runEveryMs / 10

    const jitter = Math.round(Math.random() * (jitterMax - jitterMin) + jitterMin)
    const startTime = new Date(this.clock.now() + jitter)
    this.scheduleJob(jobId, startTime, runEveryMs, jobFn)
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

  private setFirstRunTimeout(jobId: string, startTime: Date): ReturnType<typeof setTimeout> {
    const delay = Math.max(0, Number(startTime) - this.clock.now())
    if (delay <= MAX_TIMEOUT_MS) {
      return setTimeout(() => this.runJob(jobId), delay)
    }

    return setTimeout(() => {
      const job = this.jobs.get(jobId)
      if (job) {
        job.currentTimeout = this.setFirstRunTimeout(jobId, startTime)
      }
    }, MAX_TIMEOUT_MS)
  }

  private runJob(jobId: string) {
    if (!this.jobs.has(jobId)) {
      logger.warn(`Woke to run job ${jobId} but it wasn't found in the schedule`)
    }

    const job = this.jobs.get(jobId)!
    if (job.runEveryMs >= 0) {
      job.currentTimeout = setTimeout(() => this.runJob(jobId), job.runEveryMs)
    } else {
      this.unscheduleJob(jobId)
    }

    const startTime = monotonicNow()
    job.jobFn().then(
      () => {
        const completionTime = monotonicNow()
        this.runtimeMetric.labels(jobId).observe((completionTime - startTime) / 1000)
      },
      err => {
        logger.error({ err }, `Error while running ${jobId}`)
      },
    )
  }
}
