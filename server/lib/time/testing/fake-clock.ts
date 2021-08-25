import { Clock, TimeoutId } from '../clock'

type ScheduledTimeout = [fn: () => void, timeoutMillis: number]

export class FakeClock extends Clock {
  private currentTime = 0

  private currentTimeoutId: TimeoutId = 0 as unknown as TimeoutId
  private timeoutsToRun: ScheduledTimeout[] = []
  private timeoutsCompletedPromise = Promise.resolve()
  private timeoutsCompletedResolve = () => {}
  private timeoutRunnerScheduled = false

  setCurrentTime(time: number) {
    this.currentTime = time
  }

  override now() {
    return this.currentTime
  }

  override monotonicNow() {
    return this.currentTime
  }

  // TODO(tec27): Build a system for only running X timeouts. This auto setup only works if the
  // timeout setting terminates (e.g. a called timeout doesn't schedule an additional timeout).
  override setTimeout(fn: () => void, timeoutMillis: number): TimeoutId {
    this.timeoutsToRun.push([fn, timeoutMillis])
    if (!this.timeoutRunnerScheduled) {
      this.timeoutRunnerScheduled = true
      this.timeoutsCompletedPromise = new Promise(resolve => {
        this.timeoutsCompletedResolve = resolve
      })
      queueMicrotask(() => this.runTimeouts())
    }

    this.currentTimeoutId = (Number(this.currentTimeoutId) + 1) as unknown as TimeoutId
    return this.currentTimeoutId
  }

  /** Returns a promise that resolves when all the currently scheduled timeouts have been run. */
  async allTimeoutsCompleted() {
    return this.timeoutsCompletedPromise
  }

  private async runTimeouts() {
    try {
      do {
        const toRun = this.timeoutsToRun
        this.timeoutsToRun = []

        toRun.sort((a, b) => a[1] - b[1])
        let lastTimeout = 0
        for (const [fn, timeoutMillis] of toRun) {
          this.currentTime += timeoutMillis - lastTimeout
          lastTimeout = timeoutMillis
          fn()
        }

        // In case the timer functions themselves use promises, we wait for the event queue to come
        // back around
        await new Promise<void>(resolve => setTimeout(resolve, 0))
      } while (this.timeoutsToRun.length)
    } finally {
      this.timeoutRunnerScheduled = false
      this.timeoutsCompletedResolve()
    }
  }
}
