/**
 * A cap on how many fetches a caller may start per fixed time window. Content rendered from message
 * text is sender-controlled, so anything that fetches on its behalf (e.g. rich cards for links in
 * chat) must not be able to fan out an unbounded number of requests: each one would come out of the
 * endpoint's throttle, which also serves the user's own browsing, and none of them are the user's
 * own doing.
 */
export class FetchBudget {
  private windowStart = 0
  private used = 0

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Consumes one unit if any remains in the current window, returning whether it did. */
  take(now: number = Date.now()): boolean {
    if (now - this.windowStart >= this.windowMs) {
      this.windowStart = now
      this.used = 0
    }
    if (this.used >= this.limit) {
      return false
    }
    this.used += 1
    return true
  }

  /** Restores the full budget, starting a new window on the next {@link take}. */
  reset(): void {
    this.windowStart = 0
    this.used = 0
  }
}
