const SECONDS_MS = 1000
const MINUTES_MS = 60 * SECONDS_MS
const HOURS_MS = 60 * MINUTES_MS
const DAYS_MS = 24 * HOURS_MS
const WEEKS_MS = 7 * DAYS_MS
const MONTHS_PER_YEAR = 12

/** Milliseconds elapsed since local midnight, read from local fields to stay DST-independent. */
function getLocalTimeOfDayMs(date: Date): number {
  return (
    date.getHours() * HOURS_MS +
    date.getMinutes() * MINUTES_MS +
    date.getSeconds() * SECONDS_MS +
    date.getMilliseconds()
  )
}

/**
 * Counts the whole calendar months from `earlier` to `later` in local time. A month only counts
 * once `later` reaches the same day of month and time of day as `earlier`, so Jan 31 to Feb 29 is
 * 0 months while Feb 1 to Mar 1 is 1 month, regardless of how many days each month has.
 */
function countWholeCalendarMonths(earlier: Date, later: Date): number {
  const monthDelta =
    (later.getFullYear() - earlier.getFullYear()) * MONTHS_PER_YEAR +
    (later.getMonth() - earlier.getMonth())
  const earlierPosInMonth = earlier.getDate() * DAYS_MS + getLocalTimeOfDayMs(earlier)
  const laterPosInMonth = later.getDate() * DAYS_MS + getLocalTimeOfDayMs(later)
  return laterPosInMonth < earlierPosInMonth ? monthDelta - 1 : monthDelta
}

type RelativeTimeFormatUnit =
  | 'year'
  | 'years'
  | 'quarter'
  | 'quarters'
  | 'month'
  | 'months'
  | 'week'
  | 'weeks'
  | 'day'
  | 'days'
  | 'hour'
  | 'hours'
  | 'minute'
  | 'minutes'
  | 'second'
  | 'seconds'

export class RelativeTimeFormatter {
  private formatter: Intl.RelativeTimeFormat

  constructor(locales?: string | string[], options?: Intl.RelativeTimeFormatOptions) {
    this.formatter = new Intl.RelativeTimeFormat(locales, options)
  }

  format(to: Date | number | string, from: Date | number | string = new Date()): string {
    if (!(to instanceof Date)) {
      to = new Date(to)
    }
    if (!(from instanceof Date)) {
      from = new Date(from)
    }

    return this.formatter.format(...this.getFormatterArgs(to, from))
  }

  private getFormatterArgs(to: Date, from: Date): [value: number, unit: RelativeTimeFormatUnit] {
    const diff = Number(to) - Number(from)
    const delta = Math.abs(diff)
    const sign = Math.sign(diff)

    const [earlier, later] = diff < 0 ? [to, from] : [from, to]
    const months = countWholeCalendarMonths(earlier, later)
    const years = Math.floor(months / MONTHS_PER_YEAR)
    if (years >= 1) {
      return [sign * years, 'year']
    }

    if (months >= 1) {
      return [sign * months, 'month']
    }

    const weeks = Math.floor(delta / WEEKS_MS)
    if (weeks >= 1) {
      return [sign * weeks, 'week']
    }

    const days = Math.floor(delta / DAYS_MS)
    if (days >= 1) {
      return [sign * days, 'day']
    }

    const hours = Math.floor(delta / HOURS_MS)
    if (hours >= 1) {
      return [sign * hours, 'hour']
    }

    const minutes = Math.floor(delta / MINUTES_MS)
    if (minutes >= 1) {
      return [sign * minutes, 'minute']
    }

    const seconds = Math.floor(delta / SECONDS_MS)
    return [sign * seconds, 'second']
  }
}
