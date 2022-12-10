import { TFunction } from 'i18next'

const SECONDS = 1000
const MINUTES = 60 * SECONDS
const HOURS = 60 * MINUTES
const DAYS = 24 * HOURS
const WEEKS = 7 * DAYS
const MONTHS = Math.round(30.42 * DAYS)
const YEARS = Math.round(365.25 * DAYS)

/**
 * Returns a short string representing the difference between two dates.
 *
 * @param diffMs Number representing a difference between two dates, in milliseconds.
 *
 * @example
 *
 * const NOW = Date.now()
 * const twoDaysAgo = NOW - 2 * 24 * 60 * 60 * 1000
 * console.log(timeAgo(NOW - twoDaysAgo)) // -> '2d ago'
 */
export function timeAgo(diffMs: number, t?: TFunction): string {
  if (diffMs < 5 * SECONDS) {
    return t ? t('time.timeAgo.now', 'just now') : 'just now'
  } else if (diffMs < MINUTES) {
    return t
      ? t('time.timeAgo.seconds', {
          defaultValue: '{{seconds}}s ago',
          seconds: Math.floor(diffMs / SECONDS),
        })
      : `${Math.floor(diffMs / SECONDS)}s ago`
  } else if (diffMs < HOURS) {
    return t
      ? t('time.timeAgo.minutes', {
          defaultValue: '{{minutes}}m ago',
          minutes: Math.floor(diffMs / MINUTES),
        })
      : `${Math.floor(diffMs / MINUTES)}m ago`
  } else if (diffMs < DAYS) {
    return t
      ? t('time.timeAgo.hours', {
          defaultValue: '{{hours}}h ago',
          hours: Math.floor(diffMs / HOURS),
        })
      : `${Math.floor(diffMs / HOURS)}h ago`
  } else if (diffMs < WEEKS) {
    return t
      ? t('time.timeAgo.days', {
          defaultValue: '{{days}}d ago',
          days: Math.floor(diffMs / DAYS),
        })
      : `${Math.floor(diffMs / DAYS)}d ago`
  } else if (diffMs < MONTHS) {
    return t
      ? t('time.timeAgo.weeks', {
          defaultValue: '{{weeks}}w ago',
          weeks: Math.floor(diffMs / WEEKS),
        })
      : `${Math.floor(diffMs / WEEKS)}w ago`
  } else if (diffMs < YEARS) {
    return t
      ? t('time.timeAgo.months', {
          defaultValue: '{{months}}mo ago',
          months: Math.floor(diffMs / MONTHS),
        })
      : `${Math.floor(diffMs / MONTHS)}mo ago`
  } else {
    return t
      ? t('time.timeAgo.years', {
          defaultValue: '{{years}}y ago',
          years: Math.floor(diffMs / YEARS),
        })
      : `${Math.floor(diffMs / YEARS)}y ago`
  }
}
