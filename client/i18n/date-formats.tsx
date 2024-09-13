import React from 'react'
import { Except } from 'type-fest'
import { Tooltip, TooltipProps } from '../material/tooltip.js'
import { RelativeTimeFormatter } from './relative-time.js'

/** A formatter for short timestamps (e.g. things that just need to show the hour + minute). */
export const shortTimestamp = new Intl.DateTimeFormat(navigator.language, {
  hour: 'numeric',
  minute: '2-digit',
})

/**
 * A formatter for long timestamps (things that need to show the full information about a time
 * down to the minute, including the date). This should generally be used for tooltips on displays
 * of `shortTimestamp`.
 */
export const longTimestamp = new Intl.DateTimeFormat(navigator.language, {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: 'numeric',
  minute: '2-digit',
})

/** A formatter for timestamps that shows the full month and day. */
export const monthDay = new Intl.DateTimeFormat(navigator.language, {
  month: 'long',
  day: 'numeric',
})

/**
 * A formatter for timestamps that show a short, relative time since something occurred,
 * e.g. "5m ago", "1d ago".
 */
export const narrowDuration = new RelativeTimeFormatter(navigator.language, {
  style: 'narrow',
  numeric: 'always',
})

export interface NarrowDurationProps {
  to: Date | number
  from?: Date | number
  className?: string
  tooltipProps?: Except<TooltipProps, 'text' | 'children'>
}

/**
 * A component that formats a timestamp as a short, relative time since something occurred,
 * e.g. "5m ago", "1d ago". It also provides a tooltip to show the exact timestamp.
 */
export function NarrowDuration({ to, from, className, tooltipProps = {} }: NarrowDurationProps) {
  return (
    <Tooltip {...tooltipProps} text={longTimestamp.format(to)}>
      <span className={className}>{narrowDuration.format(to, from)}</span>
    </Tooltip>
  )
}
