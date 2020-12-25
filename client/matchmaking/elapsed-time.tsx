import React, { CSSProperties } from 'react'

export interface ElapsedTimeProps {
  prefix?: string
  timeMs: number
  className?: string
  style?: CSSProperties
}

export function ElapsedTime({ className, prefix, style, timeMs }: ElapsedTimeProps) {
  const timeSec = Math.floor(timeMs / 1000)
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
