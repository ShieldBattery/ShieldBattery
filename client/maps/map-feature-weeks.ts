import { TFunction } from 'i18next'

const DAY_MS = 24 * 60 * 60 * 1000
const WEEK_MS = 7 * DAY_MS

/** How many weeks after the current one the feature dialog offers. */
export const FEATURE_WEEKS_AHEAD = 12

/** The most characters a feature's blurb can have. */
export const MAX_FEATURE_BLURB_LENGTH = 400

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const

/**
 * The start of the week holding `time`, as features count weeks: the Monday before it (or of it)
 * at 00:00 UTC.
 */
export function weekStartOf(time: Date | number): Date {
  const startOfDay = Math.floor(Number(time) / DAY_MS) * DAY_MS
  // getUTCDay is 0 for Sunday; Monday starts the week
  const daysSinceMonday = (new Date(startOfDay).getUTCDay() + 6) % 7
  return new Date(startOfDay - daysSinceMonday * DAY_MS)
}

/** A date as its day and month in UTC, the way staff tools show weeks: "10 Nov". */
export function formatDayMonth(date: Date): string {
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`
}

/** A date as its day, month and year in UTC: "10 Nov 2026". */
export function formatDayMonthYear(date: Date): string {
  return `${formatDayMonth(date)} ${date.getUTCFullYear()}`
}

/** The days a week covers, in UTC: "10 Nov to 16 Nov 2026" (with both years when they differ). */
export function formatWeekRange(week: Date): string {
  const lastDay = new Date(week.getTime() + 6 * DAY_MS)
  const start =
    week.getUTCFullYear() === lastDay.getUTCFullYear()
      ? formatDayMonth(week)
      : formatDayMonthYear(week)
  return `${start} to ${formatDayMonthYear(lastDay)}`
}

/** What a week already holds, for the feature dialog. */
export interface TakenWeek {
  /** The name of the map or collection picked for the week. */
  name: string
  /** Whether the pick is the same map or collection the dialog features. */
  sameTarget: boolean
  /** What staff wrote about the pick. */
  blurb: string
}

/** A week the feature dialog offers. */
export interface FeatureWeekOption {
  /** When the week starts, as an ISO string (the value the server takes). */
  value: string
  week: Date
  label: string
  /** What the week already holds, if anything. */
  taken?: TakenWeek
}

/**
 * The weeks the feature dialog offers: the current one and the {@link FEATURE_WEEKS_AHEAD} after it,
 * labelled "This week · 10 Nov", "17 Nov", and for a week that holds a pick, its name after the
 * date ("17 Nov · Polypoid"). `taken` holds the weeks with picks, by the time each starts.
 */
export function featureWeekOptions(
  now: Date | number,
  taken: ReadonlyMap<number, TakenWeek>,
): FeatureWeekOption[] {
  const thisWeek = weekStartOf(now)
  return Array.from({ length: FEATURE_WEEKS_AHEAD + 1 }, (_, i) => {
    const week = new Date(thisWeek.getTime() + i * WEEK_MS)
    const takenWeek = taken.get(week.getTime())
    const parts = [formatDayMonth(week)]
    if (i === 0) {
      parts.unshift('This week')
    }
    if (takenWeek) {
      parts.push(takenWeek.name)
    }
    return { value: week.toISOString(), week, label: parts.join(' · '), taken: takenWeek }
  })
}

/**
 * The week the feature dialog starts out on: `fixedWeek` when it edits a given week, else the first
 * week without a pick, else the first week offered.
 */
export function initialFeatureWeek(
  options: ReadonlyArray<FeatureWeekOption>,
  fixedWeek?: string,
): string | undefined {
  if (fixedWeek) {
    return new Date(fixedWeek).toISOString()
  }
  return (options.find(o => !o.taken) ?? options[0])?.value
}

/**
 * The line under the week select saying which pick saving replaces, when the chosen week holds
 * another map or collection.
 */
export function replacesText(option: FeatureWeekOption | undefined): string | undefined {
  return option?.taken && !option.taken.sameTarget ? `Replaces ${option.taken.name}` : undefined
}

/** What the map page says about a map having been the map of the week, if it has been. */
export interface FeaturedChip {
  /** Whether the map is the map of the week right now. */
  current: boolean
  /** When the latest week it was picked for starts. */
  week: Date
}

/**
 * The map page's chip for a map's featured weeks (newest first, up to the current one): whether the
 * newest is the current week, and when it starts. Undefined for a map that was never picked.
 */
export function featuredChip(
  featuredWeeks: ReadonlyArray<string>,
  now: Date | number,
): FeaturedChip | undefined {
  if (!featuredWeeks.length) {
    return undefined
  }
  const week = new Date(featuredWeeks[0])
  return { current: week.getTime() === weekStartOf(now).getTime(), week }
}

/**
 * The text of the map page's chip for a map's featured weeks (newest first, up to the current one):
 * "Map of the week" while it is, else with the latest week it was, as `formatDate` writes the day
 * that week starts. Undefined for a map that was never picked.
 */
export function featuredChipText(
  featuredWeeks: ReadonlyArray<string>,
  now: Date | number,
  formatDate: (date: Date) => string,
  t: TFunction,
): string | undefined {
  const chip = featuredChip(featuredWeeks, now)
  if (!chip) {
    return undefined
  }
  return chip.current
    ? t('maps.page.mapOfTheWeek', 'Map of the week')
    : t('maps.page.mapOfTheWeekOn', {
        defaultValue: 'Map of the week · {{date}}',
        date: formatDate(chip.week),
      })
}
