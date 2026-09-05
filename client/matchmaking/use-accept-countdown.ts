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
 * there is a match to count down. It also re-renders at each whole-second display boundary, so
 * separately mounted consumers change seconds at the same deadline-relative time. With no match
 * the values describe an empty window and nothing ticks.
 *
 * Remaining time is clamped to the full window because a stored clock sample can predate a new
 * match's accept start.
 */
export function useAcceptCountdown(
  foundMatch: FoundMatch | undefined,
  tickMs: number,
): AcceptCountdown {
  const acceptStart = foundMatch?.acceptStart
  const acceptTimeTotalMillis = foundMatch?.acceptTimeTotalMillis
  const [now, setNow] = useState(() => window.performance.now())
  useEffect(() => {
    if (acceptStart === undefined || acceptTimeTotalMillis === undefined) {
      return () => {}
    }

    const deadline = acceptStart + acceptTimeTotalMillis
    const updateInterval = Math.max(1, tickMs)
    let timeout: ReturnType<typeof setTimeout> | undefined

    const scheduleUpdate = () => {
      const currentNow = window.performance.now()
      setNow(currentNow)

      const remainingMillis = deadline - currentNow
      if (remainingMillis <= 0) {
        return
      }

      const secondsLeft = Math.ceil(remainingMillis / 1000)
      const nextSecondBoundary = deadline - (secondsLeft - 1) * 1000
      const boundaryDelay = nextSecondBoundary - currentNow
      const delay = Math.max(1, Math.min(updateInterval, boundaryDelay))
      timeout = setTimeout(scheduleUpdate, delay)
    }

    timeout = setTimeout(scheduleUpdate, 0)
    return () => {
      if (timeout !== undefined) {
        clearTimeout(timeout)
      }
    }
  }, [acceptStart, acceptTimeTotalMillis, tickMs])

  if (!foundMatch) {
    return { remainingMillis: 0, secondsLeft: 0, remainingFrac: 0, lowTime: false }
  }

  const total = foundMatch.acceptTimeTotalMillis
  const deadline = foundMatch.acceptStart + total
  const remainingMillis = Math.min(total, Math.max(0, deadline - now))
  const secondsLeft = Math.ceil(remainingMillis / 1000)
  return {
    remainingMillis,
    secondsLeft,
    remainingFrac: total > 0 ? remainingMillis / total : 0,
    lowTime: secondsLeft <= ACCEPT_LOW_TIME_SECONDS,
  }
}
