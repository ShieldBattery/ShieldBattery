const MINUTE = 60 // in seconds
const HOUR = MINUTE * 60
const DAY = HOUR * 24
const WEEK = DAY * 7
const MONTH = DAY * 30.42
const YEAR = MONTH * 12

/**
 * Returns a short string representing the difference between two dates.
 *
 * @param {number} diffMs Number representing a difference between two dates, in milliseconds.
 *
 * @example
 *
 * const NOW = Date.now()
 * const twoDaysAgo = NOW - 2 * 24 * 60 * 60 * 1000
 * console.log(timeAgo(NOW - twoDaysAgo)) // -> '2d ago'
 */
export function timeAgo(diffMs: number): string {
  const diffInSeconds = diffMs / 1000

  let interval = diffInSeconds / YEAR
  if (interval >= 1) {
    return `${Math.floor(interval)}y ago`
  }

  interval = diffInSeconds / MONTH
  if (interval >= 1) {
    return `${Math.floor(interval)}mo ago`
  }

  interval = diffInSeconds / WEEK
  if (interval >= 1) {
    return `${Math.floor(interval)}w ago`
  }

  interval = diffInSeconds / DAY
  if (interval >= 1) {
    return `${Math.floor(interval)}d ago`
  }

  interval = diffInSeconds / HOUR
  if (interval >= 1) {
    return `${Math.floor(interval)}h ago`
  }

  interval = diffInSeconds / MINUTE
  if (interval >= 1) {
    return `${Math.floor(interval)}m ago`
  }

  return `${Math.floor(diffInSeconds)}s ago`
}
