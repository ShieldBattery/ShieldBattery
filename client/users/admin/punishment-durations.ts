/** Preset lengths an admin can pick for a ban or restriction, or `Custom` to enter an end time. */
export enum PunishmentDuration {
  ThirtyMinutes = '30m',
  OneHour = '1h',
  TwoHours = '2h',
  FourHours = '4h',
  EightHours = '8h',
  TwelveHours = '12h',
  OneDay = '1d',
  TwoDays = '2d',
  ThreeDays = '3d',
  OneWeek = '1w',
  TwoWeeks = '2w',
  ThreeWeeks = '3w',
  OneMonth = '1mo',
  TwoMonths = '2mo',
  ThreeMonths = '3mo',
  SixMonths = '6mo',
  OneYear = '1y',
  Custom = 'custom',
}

export const ALL_PUNISHMENT_DURATIONS: ReadonlyArray<PunishmentDuration> =
  Object.values(PunishmentDuration)

type PresetDuration = Exclude<PunishmentDuration, PunishmentDuration.Custom>

const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

/**
 * The length of each preset: a fixed number of milliseconds, or a number of calendar months (for
 * lengths whose real duration depends on the calendar).
 */
const PRESET_LENGTHS: Record<PresetDuration, { ms: number } | { months: number }> = {
  [PunishmentDuration.ThirtyMinutes]: { ms: 30 * MINUTE_MS },
  [PunishmentDuration.OneHour]: { ms: HOUR_MS },
  [PunishmentDuration.TwoHours]: { ms: 2 * HOUR_MS },
  [PunishmentDuration.FourHours]: { ms: 4 * HOUR_MS },
  [PunishmentDuration.EightHours]: { ms: 8 * HOUR_MS },
  [PunishmentDuration.TwelveHours]: { ms: 12 * HOUR_MS },
  [PunishmentDuration.OneDay]: { ms: DAY_MS },
  [PunishmentDuration.TwoDays]: { ms: 2 * DAY_MS },
  [PunishmentDuration.ThreeDays]: { ms: 3 * DAY_MS },
  [PunishmentDuration.OneWeek]: { ms: 7 * DAY_MS },
  [PunishmentDuration.TwoWeeks]: { ms: 14 * DAY_MS },
  [PunishmentDuration.ThreeWeeks]: { ms: 21 * DAY_MS },
  [PunishmentDuration.OneMonth]: { months: 1 },
  [PunishmentDuration.TwoMonths]: { months: 2 },
  [PunishmentDuration.ThreeMonths]: { months: 3 },
  [PunishmentDuration.SixMonths]: { months: 6 },
  [PunishmentDuration.OneYear]: { months: 12 },
}

const LABELS: Record<PunishmentDuration, string> = {
  [PunishmentDuration.ThirtyMinutes]: '30 minutes',
  [PunishmentDuration.OneHour]: '1 hour',
  [PunishmentDuration.TwoHours]: '2 hours',
  [PunishmentDuration.FourHours]: '4 hours',
  [PunishmentDuration.EightHours]: '8 hours',
  [PunishmentDuration.TwelveHours]: '12 hours',
  [PunishmentDuration.OneDay]: '1 day',
  [PunishmentDuration.TwoDays]: '2 days',
  [PunishmentDuration.ThreeDays]: '3 days',
  [PunishmentDuration.OneWeek]: '1 week',
  [PunishmentDuration.TwoWeeks]: '2 weeks',
  [PunishmentDuration.ThreeWeeks]: '3 weeks',
  [PunishmentDuration.OneMonth]: '1 month',
  [PunishmentDuration.TwoMonths]: '2 months',
  [PunishmentDuration.ThreeMonths]: '3 months',
  [PunishmentDuration.SixMonths]: '6 months',
  [PunishmentDuration.OneYear]: '1 year',
  [PunishmentDuration.Custom]: 'Custom',
}

export function punishmentDurationToLabel(duration: PunishmentDuration): string {
  return LABELS[duration]
}

/**
 * Returns the end time (in ms) of a punishment of the preset `duration` starting at `now`. Months
 * and years are calendar lengths in local time (a month from Jan 31 is the last day of February).
 */
export function presetEndTime(duration: PresetDuration, now: number): number {
  const length = PRESET_LENGTHS[duration]
  return 'ms' in length ? now + length.ms : addMonths(now, length.months)
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
