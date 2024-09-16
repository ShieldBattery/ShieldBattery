import { injectable } from 'tsyringe'
import { Promisable } from 'type-fest'
import swallowNonBuiltins from '../../../common/async/swallow-non-builtins.js'
import { Clock, TimeoutId } from '../time/clock.js'

/**
 * A method scheduled to run periodically.
 *
 * @param timeSinceLastRunMillis the number of milliseconds since this method last ran. Will include
 *    time that the LazyScheduler was not running.
 * @returns a boolean (or a Promise that returns a boolean) indicating whether the LazyScheduler
 *    should keep scheduling work
 */
export type ScheduledMethod = (timeSinceLastRunMillis: number) => Promisable<boolean>

/**
 * Schedules a method to run every N milliseconds, using the result of the method to decide whether
 * or not to reschedule. Intended for scheduling things that need to run periodically, but can run
 * out of work to do.
 *
 * Methods are scheduled for `delayMillis` milliseconds after the *start* of the scheduled method
 * run time, so if the method runs longer than `delayMillis`, some iterations may be skipped. This
 * will be indicated by `timeSinceLastRunMillis` being a >1 multiple of `delayMillis`.
 */
@injectable()
export class LazyScheduler {
  #delayMillis = 1000
  private method: ScheduledMethod = () => false
  private errorHandler: (err: Error) => boolean = () => false

  private lastRunTime: number
  private timeoutId: TimeoutId | undefined

  constructor(private clock: Clock) {
    this.lastRunTime = this.clock.monotonicNow()
  }

  /**
   * The number of milliseconds that will pass between the end of one scheduled method call and the
   * start of another.
   */
  get delayMillis() {
    return this.#delayMillis
  }

  /**
   * Sets the amount of time that should pass between iterations. This will not affect only future
   * schedules, not any currently scheduled method calls.
   *
   * @param delayMillis the amount of milliseconds to pass between the start of one method call and
   *    the start of the next
   */
  setDelay(delayMillis: number): this {
    if (delayMillis < 20) {
      throw new Error('Delays less than 20ms are not supported')
    }

    this.#delayMillis = delayMillis
    if (!this.timeoutId) {
      this.lastRunTime = this.clock.monotonicNow()
    }

    return this
  }

  /**
   * Sets the method that will be scheduled when needed. This will be called on the next scheduled
   * iteration.
   */
  setMethod(method: ScheduledMethod): this {
    this.method = method
    if (!this.timeoutId) {
      this.lastRunTime = this.clock.monotonicNow()
    }
    return this
  }

  /**
   * Register a method to be called if the scheduled method throws or rejects.
   */
  setErrorHandler(errorHandler: (err: Error) => boolean): this {
    this.errorHandler = errorHandler
    return this
  }

  /**
   * Schedules a method call if one has not already been scheduled.
   */
  scheduleIfNeeded(): this {
    if (!this.timeoutId) {
      this.timeoutId = this.clock.setTimeout(this.onTimeout, this.getNextDelay())
    }

    return this
  }

  /** Calculate a next time such that it falls on a multiple of `delayMillis`. */
  private getNextDelay(): number {
    const now = this.clock.monotonicNow()
    const nextDelay = (now - this.lastRunTime) % this.#delayMillis
    // This has a bit of a fudge factor because the way timings of things work out means we
    // sometimes hit a bit early, and we don't want to rerun e.g. 4ms later if we just ran and the
    // delay is much larger
    return nextDelay < 20 ? this.#delayMillis : nextDelay
  }

  private onTimeout = () => {
    const now = this.clock.monotonicNow()
    const sinceLast = now - this.lastRunTime
    this.lastRunTime = now

    Promise.resolve()
      .then(() => this.method(sinceLast))
      .catch(this.errorHandler)
      .then(shouldContinue => {
        if (shouldContinue) {
          this.timeoutId = this.clock.setTimeout(this.onTimeout, this.getNextDelay())
        } else {
          this.timeoutId = undefined
        }
      })
      .catch(swallowNonBuiltins)
  }
}
