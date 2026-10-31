/** Cancellation belongs to one launch, including preparation before a native owner exists. */
export class ProcessLaunchControl {
  private cancelled = false
  private process?: { terminate(): Promise<void> }
  private exited = false
  private termination?: Promise<void>
  onTerminated?: () => Promise<void>

  get mayBeRunning(): boolean {
    return !!this.process && !this.exited
  }

  markExited(): void {
    this.exited = true
  }

  attach(process: { terminate(): Promise<void> }): void {
    if (this.cancelled) throw new Error('Game launch cancelled')
    this.process = process
  }

  terminate(): Promise<void> {
    this.cancelled = true
    if (!this.termination) {
      this.termination = (async () => {
        await this.process?.terminate()
        this.exited = true
        await this.onTerminated?.()
      })().catch(err => {
        // A failed OS termination must remain retryable and must not retire the live launch.
        this.termination = undefined
        throw err
      })
    }
    return this.termination
  }
}
