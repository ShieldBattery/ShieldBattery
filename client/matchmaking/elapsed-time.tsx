import React, { CSSProperties, useState, useEffect } from 'react'

type TickerCallback = () => void

class UnifiedTicker {
  private counter = 0
  private registered = new Map<number, TickerCallback>()
  private timer: ReturnType<typeof setInterval> | null = null

  register(cb: TickerCallback) {
    const key = this.counter
    this.counter += 1
    this.registered.set(key, cb)

    if (!this.timer) {
      this.timer = setInterval(() => {
        for (const cb of this.registered.values()) {
          cb()
        }
      }, 1000)
    }

    return () => this.unregister(key)
  }

  private unregister(key: number) {
    this.registered.delete(key)
    if (!this.registered.size && this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }
}
const unifiedTicker = new UnifiedTicker()

export interface ElapsedTimeProps {
  /**
   * A prefix
   */
  prefix?: string
  /**
   * The time this counter counts up from. Should be the return value of
   * `window.performance.now()`.
   */
  startTimeMs: number
  className?: string
  style?: CSSProperties
}

export function ElapsedTime({ className, prefix, style, startTimeMs }: ElapsedTimeProps) {
  const [elapsedTime, setElapsedTime] = useState(window.performance.now() - startTimeMs)

  useEffect(() => {
    const unregister = unifiedTicker.register(() =>
      setElapsedTime(window.performance.now() - startTimeMs),
    )

    return unregister
  }, [startTimeMs])

  const timeSec = Math.floor(elapsedTime / 1000)
  const hours = Math.floor(timeSec / 3600)
  const minutes = Math.floor(timeSec / 60) % 60
  const seconds = timeSec % 60

  const timeStr =
    (prefix ?? '') +
    [hours, minutes, seconds]
      .map(v => ('' + v).padStart(2, '0'))
      .filter((v, i) => v !== '00' || i > 0)
      .join(':')

  return (
    <div className={className} style={style}>
      {timeStr}
    </div>
  )
}
