const SECONDS_MS = 1000
const MINUTES_MS = 60 * SECONDS_MS
const HOURS_MS = 60 * MINUTES_MS
const DAYS_MS = 24 * HOURS_MS
const WEEKS_MS = 7 * DAYS_MS
const MONTHS_MS = 30 * DAYS_MS
const YEARS_MS = 365 * DAYS_MS

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

    const years = Math.floor(delta / YEARS_MS)
    if (years >= 1) {
      return [sign * years, 'year']
    }

    const months = Math.floor(delta / MONTHS_MS)
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
