/** Preset lengths an admin can pick for a ban or restriction, or `Custom` to enter an end time. */
export enum PunishmentDuration {
  OneHour = '1h',
  OneDay = '1d',
  ThreeDays = '3d',
  OneWeek = '1w',
  TwoWeeks = '2w',
  OneMonth = '1mo',
  ThreeMonths = '3mo',
  OneYear = '1y',
  Custom = 'custom',
}

export const ALL_PUNISHMENT_DURATIONS: ReadonlyArray<PunishmentDuration> =
  Object.values(PunishmentDuration)

export function punishmentDurationToLabel(duration: PunishmentDuration): string {
  switch (duration) {
    case PunishmentDuration.OneHour:
      return '1 hour'
    case PunishmentDuration.OneDay:
      return '1 day'
    case PunishmentDuration.ThreeDays:
      return '3 days'
    case PunishmentDuration.OneWeek:
      return '1 week'
    case PunishmentDuration.TwoWeeks:
      return '2 weeks'
    case PunishmentDuration.OneMonth:
      return '1 month'
    case PunishmentDuration.ThreeMonths:
      return '3 months'
    case PunishmentDuration.OneYear:
      return '1 year'
    case PunishmentDuration.Custom:
      return 'Custom'
    default:
      return duration satisfies never
  }
}

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

/**
 * Returns the end time (in ms) of a punishment of the preset `duration` starting at `now`. Months
 * and years are calendar lengths in local time (a month from Jan 31 is the last day of February).
 */
export function presetEndTime(
  duration: Exclude<PunishmentDuration, PunishmentDuration.Custom>,
  now: number,
): number {
  switch (duration) {
    case PunishmentDuration.OneHour:
      return now + HOUR_MS
    case PunishmentDuration.OneDay:
      return now + DAY_MS
    case PunishmentDuration.ThreeDays:
      return now + 3 * DAY_MS
    case PunishmentDuration.OneWeek:
      return now + 7 * DAY_MS
    case PunishmentDuration.TwoWeeks:
      return now + 14 * DAY_MS
    case PunishmentDuration.OneMonth:
      return addMonths(now, 1)
    case PunishmentDuration.ThreeMonths:
      return addMonths(now, 3)
    case PunishmentDuration.OneYear:
      return addMonths(now, 12)
    default:
      return duration satisfies never
  }
}

function addMonths(time: number, months: number): number {
  const date = new Date(time)
  const day = date.getDate()
  date.setDate(1)
  date.setMonth(date.getMonth() + months)
  const daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
  date.setDate(Math.min(day, daysInMonth))
  return date.getTime()
}
