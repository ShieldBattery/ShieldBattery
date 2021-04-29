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
export function timeAgo(diffMs: number): string {
  if (diffMs < MINUTES) {
    return `${Math.floor(diffMs / SECONDS)}s ago`
  } else if (diffMs < HOURS) {
    return `${Math.floor(diffMs / MINUTES)}m ago`
  } else if (diffMs < DAYS) {
    return `${Math.floor(diffMs / HOURS)}h ago`
  } else if (diffMs < WEEKS) {
    return `${Math.floor(diffMs / DAYS)}d ago`
  } else if (diffMs < MONTHS) {
    return `${Math.floor(diffMs / WEEKS)}w ago`
  } else if (diffMs < YEARS) {
    return `${Math.floor(diffMs / MONTHS)}mo ago`
  } else {
    return `${Math.floor(diffMs / YEARS)}y ago`
  }
}
