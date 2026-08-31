import { useEffect, useState, useSyncExternalStore } from 'react'

/**
 * Returns `Date.now()`, updated every `updateIntervalMs` milliseconds. Defaults to updating every
 * second.
 */
export function useNow(updateIntervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Date.now())
    }, updateIntervalMs)

    return () => {
      clearInterval(interval)
    }
  }, [updateIntervalMs])

  return now
}

const MINUTE_MS = 60 * 1000
// Frequent enough that the shared minute value can't drift more than this far past an actual
// minute boundary, without running a timer per subscriber.
const MINUTE_CLOCK_POLL_MS = 15 * 1000

function roundDownToMinute(ms: number): number {
  return ms - (ms % MINUTE_MS)
}

let currentMinuteMs = roundDownToMinute(Date.now())
let intervalId: ReturnType<typeof setInterval> | undefined
const minuteClockListeners = new Set<() => void>()

function tickMinuteClock() {
  const nextMinuteMs = roundDownToMinute(Date.now())
  if (nextMinuteMs !== currentMinuteMs) {
    currentMinuteMs = nextMinuteMs
    for (const listener of minuteClockListeners) {
      listener()
    }
  }
}

function subscribeToMinuteClock(listener: () => void): () => void {
  minuteClockListeners.add(listener)
  if (intervalId === undefined) {
    // The stored minute can be arbitrarily stale from a period with no subscribers (and thus no
    // running timer), so sync it before the first snapshot read instead of waiting out a poll.
    tickMinuteClock()
    intervalId = setInterval(tickMinuteClock, MINUTE_CLOCK_POLL_MS)
  }

  return () => {
    minuteClockListeners.delete(listener)
    if (minuteClockListeners.size === 0 && intervalId !== undefined) {
      clearInterval(intervalId)
      intervalId = undefined
    }
  }
}

function getMinuteClockSnapshot(): number {
  return currentMinuteMs
}

/**
 * Returns the current time rounded down to the start of the minute (unix ms), updated as real
 * time crosses each minute boundary. Backed by a single interval shared across every subscriber
 * (started lazily on the first one, stopped once the last unsubscribes) rather than a timer per
 * caller, so a long list of rows showing relative times can all refresh together cheaply.
 */
export function useCurrentMinuteMs(): number {
  return useSyncExternalStore(subscribeToMinuteClock, getMinuteClockSnapshot)
}
