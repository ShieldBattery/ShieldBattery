const DAY_MS = 24 * 60 * 60 * 1000
const WEEK_MS = 7 * DAY_MS

/**
 * The start of the week holding `time`, as map features count weeks: the Monday before it (or of
 * it) at 00:00 UTC.
 */
export function weekStartOf(time: Date | number): Date {
  const startOfDay = Math.floor(Number(time) / DAY_MS) * DAY_MS
  // getUTCDay is 0 for Sunday; Monday starts the week
  const daysSinceMonday = (new Date(startOfDay).getUTCDay() + 6) % 7
  return new Date(startOfDay - daysSinceMonday * DAY_MS)
}

/** The start of the week after the one holding `time`: the next Monday after it at 00:00 UTC. */
export function nextWeekStartAfter(time: Date | number): Date {
  return new Date(weekStartOf(time).getTime() + WEEK_MS)
}

/** The date a week starts on, as `YYYY-MM-DD` (the way the database stores weeks). */
export function weekDateString(week: Date): string {
  return week.toISOString().slice(0, 10)
}
