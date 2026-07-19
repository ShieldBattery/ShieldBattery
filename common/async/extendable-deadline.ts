/** A deadline whose expiry can be pushed further out while the tracked work is still pending. */
export interface ExtendableDeadline {
  /**
   * Rejects when the deadline elapses before the tracked promise settles, and resolves once the
   * tracked promise settles first. Either way it settles exactly once.
   */
  readonly expired: Promise<void>
  /**
   * Moves the deadline `ms` milliseconds further out from where it currently sits. A no-op once the
   * tracked promise has settled or the deadline has already fired.
   */
  extend(ms: number): void
}

/**
 * Wraps a promise with a deadline: if `promise` hasn't settled within `ms`, `expired` rejects with
 * `msg`; if `promise` settles first, `expired` resolves and the timer is cleared. The deadline can
 * be pushed out with `extend` while the work is still pending, which is useful when a slow phase is
 * expected and known only after the wait has begun.
 */
export function extendableDeadline(
  promise: Promise<unknown>,
  ms: number,
  msg = 'Operation timed out',
): ExtendableDeadline {
  let settled = false
  // Monotonic clock: deadlines here bound elapsed time, and re-arming after extend() computes a
  // remaining duration — a wall-clock step (NTP, manual change) must not stretch or truncate it.
  let deadlineAt = performance.now() + ms
  let timerId: ReturnType<typeof setTimeout>
  let reject!: (err: Error) => void
  let resolve!: () => void

  const expired = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })

  const fire = () => {
    if (settled) return
    settled = true
    reject(new Error(msg))
  }

  const arm = () => {
    timerId = setTimeout(fire, Math.max(0, deadlineAt - performance.now()))
  }

  const finish = () => {
    if (settled) return
    settled = true
    clearTimeout(timerId)
    resolve()
  }

  promise.then(finish, finish)
  arm()

  return {
    expired,
    extend(extraMs: number) {
      if (settled) return
      deadlineAt += extraMs
      clearTimeout(timerId)
      arm()
    },
  }
}
