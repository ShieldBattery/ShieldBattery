import { useEffect, useState } from 'react'
import { FoundMatch } from './matchmaking-atoms'

/** Seconds remaining at which an accept countdown switches to its "low time" treatment. */
export const ACCEPT_LOW_TIME_SECONDS = 5

export interface AcceptCountdown {
  /** Milliseconds left in the accept window, clamped to `[0, total]`. */
  remainingMillis: number
  /** Whole seconds left in the accept window, rounded up so the display never reads 0 early. */
  secondsLeft: number
  /** Fraction of the accept window still remaining, in `[0, 1]`. */
  remainingFrac: number
  /** Whether the countdown is within `ACCEPT_LOW_TIME_SECONDS` of running out. */
  lowTime: boolean
}

/**
 * Tracks how much of the accept window for `foundMatch` is left, re-rendering every `tickMs` while
 * there is a match to count down. With no match the values describe an empty window and nothing
 * ticks.
 *
 * The clock is only sampled while a match is found, so the first render after one is found can
 * see a sample older than the match's accept start; the remaining time is clamped to the full
 * window so that render shows the window untouched rather than a bogus value.
 */
export function useAcceptCountdown(
  foundMatch: FoundMatch | undefined,
  tickMs: number,
): AcceptCountdown {
  const matched = !!foundMatch
  const [now, setNow] = useState(() => window.performance.now())
  useEffect(() => {
    if (!matched) {
      return () => {}
    }

    const interval = setInterval(() => setNow(window.performance.now()), tickMs)
    return () => clearInterval(interval)
  }, [matched, tickMs])

  if (!foundMatch) {
    return { remainingMillis: 0, secondsLeft: 0, remainingFrac: 0, lowTime: false }
  }

  const total = foundMatch.acceptTimeTotalMillis
  const remainingMillis = Math.min(total, Math.max(0, total - (now - foundMatch.acceptStart)))
  const secondsLeft = Math.ceil(remainingMillis / 1000)
  return {
    remainingMillis,
    secondsLeft,
    remainingFrac: total > 0 ? remainingMillis / total : 0,
    lowTime: secondsLeft <= ACCEPT_LOW_TIME_SECONDS,
  }
}
