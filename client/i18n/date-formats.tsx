import { Except } from 'type-fest'
import { Tooltip, TooltipProps } from '../material/tooltip'
import { dateTimeFormat, relativeTimeFormat, useFormat } from './locale-formats'

/** A formatter for short timestamps (e.g. things that just need to show the hour + minute). */
export const shortTimestamp = dateTimeFormat({
  hour: 'numeric',
  minute: '2-digit',
})

/**
 * A formatter for long timestamps (things that need to show the full information about a time
 * down to the minute, including the date). This should generally be used for tooltips on displays
 * of `shortTimestamp`.
 */
export const longTimestamp = dateTimeFormat({
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: 'numeric',
  minute: '2-digit',
})

/**
 * A formatter for long timestamps that includes seconds. This is mostly useful for things that need
 * a very high level of precision, like debug information.
 */
export const longTimestampWithSeconds = dateTimeFormat({
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
})

/** A formatter for timestamps that shows the full month and day. */
export const monthDay = dateTimeFormat({
  month: 'long',
  day: 'numeric',
})

/**
 * A formatter for timestamps that show a short, relative time since something occurred,
 * e.g. "5m ago", "1d ago".
 */
export const narrowDuration = relativeTimeFormat({
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
  const longTimestampFormat = useFormat(longTimestamp)
  const narrowDurationFormat = useFormat(narrowDuration)
  return (
    <Tooltip {...tooltipProps} text={longTimestampFormat.format(to)}>
      <span className={className}>{narrowDurationFormat.format(to, from)}</span>
    </Tooltip>
  )
}
