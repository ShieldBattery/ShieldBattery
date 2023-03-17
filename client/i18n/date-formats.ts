import { RelativeTimeFormatter } from './relative-time'

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

export const narrowDuration = new RelativeTimeFormatter(navigator.language, {
  style: 'narrow',
  numeric: 'always',
})
