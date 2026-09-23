import { EventEmitter } from 'node:events'

/** How long the system can go without any input before its user counts as idle. */
export const DEFAULT_IDLE_THRESHOLD_MS = 10 * 60 * 1000
/** How often the system's idle time is checked while the user is active. */
export const ACTIVE_POLL_INTERVAL_MS = 30_000
/**
 * How often the system's idle time is checked while the user is idle. Shorter than while active,
 * since a returning user expects to stop being shown as away right away, while going idle is
 * already only noticed after a long wait.
 */
export const IDLE_POLL_INTERVAL_MS = 5_000

/** The parts of Electron's `powerMonitor` the watcher uses. */
export interface IdleSource {
  /** Seconds since the last keyboard or mouse input anywhere on the system. */
  getSystemIdleTime(): number
  on(event: 'lock-screen' | 'unlock-screen', listener: () => void): unknown
  off(event: 'lock-screen' | 'unlock-screen', listener: () => void): unknown
}

type UserIdleWatcherEvents = {
  change: [idle: boolean]
}

/**
 * Watches whether the user has stepped away from their computer, judged by input to the whole
 * system rather than just to the app's window (a user playing a game has the app unfocused but is
 * very much present). A locked screen counts as idle as soon as it locks, and unlocking it counts
 * as being back. Emits `change` only on transitions.
 */
export class UserIdleWatcher extends EventEmitter<UserIdleWatcherEvents> {
  private idle = false
  private locked = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private started = false

  constructor(
    private source: IdleSource,
    private thresholdMs = DEFAULT_IDLE_THRESHOLD_MS,
  ) {
    super()
  }

  isIdle(): boolean {
    return this.idle
  }

  start(): void {
    if (this.started) {
      return
    }
    this.started = true
    this.source.on('lock-screen', this.onLock)
    this.source.on('unlock-screen', this.onUnlock)
    this.poll()
  }

  stop(): void {
    if (!this.started) {
      return
    }
    this.started = false
    this.source.off('lock-screen', this.onLock)
    this.source.off('unlock-screen', this.onUnlock)
    clearTimeout(this.timer)
    this.timer = undefined
  }

  private onLock = () => {
    this.locked = true
    this.setIdle(true)
  }

  private onUnlock = () => {
    this.locked = false
    this.setIdle(false)
  }

  private poll = () => {
    this.setIdle(this.locked || this.source.getSystemIdleTime() * 1000 >= this.thresholdMs)
  }

  private setIdle(idle: boolean): void {
    const changed = idle !== this.idle
    this.idle = idle
    if (this.started) {
      // Rescheduled on every update, so the interval always matches the current state.
      clearTimeout(this.timer)
      this.timer = setTimeout(this.poll, idle ? IDLE_POLL_INTERVAL_MS : ACTIVE_POLL_INTERVAL_MS)
    }
    if (changed) {
      this.emit('change', idle)
    }
  }
}
