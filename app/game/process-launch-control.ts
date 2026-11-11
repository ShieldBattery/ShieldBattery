import createDeferred from '../../common/async/deferred'

/** Tracks cancellation intent and process exit without requiring native launch cancellation. */
export class ProcessLaunchControl {
  private cancelled = false
  private started = false
  private finished = false
  private ready = createDeferred<void>()
  private process?: { waitForExit(): Promise<number> }
  private exitWait?: Promise<number>
  private cleanup?: Promise<void>
  onFinished?: () => Promise<void>

  get mayBeRunning(): boolean {
    return this.started && !this.finished
  }

  cancel(): void {
    this.cancelled = true
    if (!this.started) this.finish()
  }

  beginLaunch(): void {
    if (this.cancelled) throw new Error('Game launch cancelled')
    this.started = true
  }

  attach(process: { waitForExit(): Promise<number> }): void {
    this.process = process
    this.ready.resolve()
  }

  /** A rejected stock launch exposes no process handle; its own error cleanup applies. */
  launchFailed(): Promise<void> {
    this.finish()
    return this.cleanup!
  }

  async waitForExit(): Promise<number | undefined> {
    await this.ready
    if (!this.process) {
      await this.cleanup
      return undefined
    }
    this.exitWait ??= this.process.waitForExit().then(
      async code => {
        this.finish()
        await this.cleanup
        return code
      },
      error => {
        // Keep the process so a failed wait can be retried without claiming it exited.
        this.exitWait = undefined
        throw error
      },
    )
    return this.exitWait
  }

  private finish(): void {
    this.finished = true
    this.ready.resolve()
    this.cleanup ??= Promise.resolve().then(() => this.onFinished?.())
  }
}
