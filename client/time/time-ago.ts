const MINUTE = 60 // in seconds
const HOUR = MINUTE * 60
const DAY = HOUR * 24
const WEEK = DAY * 7
const MONTH = DAY * 30.42
const YEAR = MONTH * 12

/**
 * A function which takes the number representing a difference between two dates, and returns a
 * string representation of that difference, in "Xy ago" syntax. Where X equals amount of time, and
 * y specifies the time unit.
 *
 * Note that this is not a *perfect* measurement of time. Some values are approximated, e.g. number
 * of days in a month, and leap days/seconds/whatever are not taken into account.
 */
export function timeAgo(diff: number): string {
  let interval = diff / YEAR
  if (interval >= 1) {
    return `${Math.floor(interval)}y ago`
  }

  interval = diff / MONTH
  if (interval >= 1) {
    return `${Math.floor(interval)}mo ago`
  }

  interval = diff / WEEK
  if (interval >= 1) {
    return `${Math.floor(interval)}w ago`
  }

  interval = diff / DAY
  if (interval >= 1) {
    return `${Math.floor(interval)}d ago`
  }

  interval = diff / HOUR
  if (interval >= 1) {
    return `${Math.floor(interval)}h ago`
  }

  interval = diff / MINUTE
  if (interval >= 1) {
    return `${Math.floor(interval)}m ago`
  }

  return `${Math.floor(diff)}s ago`
}
