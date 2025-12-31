import { useEffect, useState } from 'react'

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
