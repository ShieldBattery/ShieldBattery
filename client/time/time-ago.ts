const NOW = Date.now()
const MINUTE = 60 // in seconds
const HOUR = MINUTE * 60
const DAY = HOUR * 24
const WEEK = DAY * 7
const MONTH = DAY * 30.42
const YEAR = MONTH * 12

/**
 * A function which takes the amount of time, in miliseconds, and returns a string representing how
 * much time has passsed since that time, in "Xy ago" syntax. Where X equals amount of time, and y
 * specifies the time unit.
 *
 * Note that this is not a *perfect* measurement of time. Some values are approximated, e.g. number
 * of days in a month, and leap days/seconds/whatever are not taken into account.
 */
export function timeAgo(date: number): string {
  const diffInSeconds = Math.floor((NOW - date) / 1000)

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
