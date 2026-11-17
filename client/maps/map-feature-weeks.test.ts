import { TFunction } from 'i18next'
import { describe, expect, test } from 'vitest'
import { featureErrorText } from './map-feature-actions'
import {
  featuredChip,
  featuredChipText,
  featureWeekOptions,
  formatDayMonth,
  formatWeekRange,
  initialFeatureWeek,
  replacesText,
  TakenWeek,
} from './map-feature-weeks'

/** Returns each string's default text with its `{{placeholders}}` filled in. */
const t = ((_key: string, defaultOrOptions: unknown, maybeOptions?: Record<string, unknown>) => {
  const options =
    typeof defaultOrOptions === 'string'
      ? { ...maybeOptions, defaultValue: defaultOrOptions }
      : (defaultOrOptions as Record<string, unknown>)
  return String(options.defaultValue).replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
    String(options[name] ?? ''),
  )
}) as unknown as TFunction

// Sunday evening in UTC: still the week that started on Monday 9 November 2026
const NOW = Date.parse('2026-11-15T23:30:00Z')
const THIS_WEEK = Date.parse('2026-11-09T00:00:00Z')
const NEXT_WEEK = Date.parse('2026-11-16T00:00:00Z')

describe('client/maps/map-feature-weeks', () => {
  test('writes days and weeks in UTC', () => {
    expect(formatDayMonth(new Date(THIS_WEEK))).toBe('9 Nov')
    expect(formatWeekRange(new Date(THIS_WEEK))).toBe('9 Nov to 15 Nov 2026')
    expect(formatWeekRange(new Date(Date.parse('2026-12-28T00:00:00Z')))).toBe(
      '28 Dec 2026 to 3 Jan 2027',
    )
  })

  test('offers this week and the next 12, labelled with what they hold', () => {
    const taken = new Map<number, TakenWeek>([
      [NEXT_WEEK, { name: 'Polypoid', sameTarget: false, blurb: '' }],
    ])
    const options = featureWeekOptions(NOW, taken)
    expect(options).toHaveLength(13)
    expect(options.every(o => o.week.getUTCDay() === 1 && o.week.getUTCHours() === 0)).toBe(true)
    expect(options[0].value).toBe('2026-11-09T00:00:00.000Z')
    expect(options[0].label).toBe('This week · 9 Nov')
    expect(options[1].label).toBe('16 Nov · Polypoid')
    expect(options[1].taken?.name).toBe('Polypoid')
    expect(options[2].label).toBe('23 Nov')
    expect(options[12].value).toBe('2027-02-01T00:00:00.000Z')
  })

  test('preselects the first week without a pick', () => {
    const taken = new Map<number, TakenWeek>([
      [THIS_WEEK, { name: 'Fighting Spirit', sameTarget: false, blurb: '' }],
      [NEXT_WEEK, { name: 'Polypoid', sameTarget: true, blurb: 'Back again' }],
    ])
    const options = featureWeekOptions(NOW, taken)
    expect(initialFeatureWeek(options)).toBe('2026-11-23T00:00:00.000Z')
    expect(initialFeatureWeek(featureWeekOptions(NOW, new Map()))).toBe('2026-11-09T00:00:00.000Z')
    expect(initialFeatureWeek(options, '2026-11-16T00:00:00Z')).toBe('2026-11-16T00:00:00.000Z')
  })

  test('says which pick saving replaces, unless it is the same one', () => {
    const taken = new Map<number, TakenWeek>([
      [THIS_WEEK, { name: 'Fighting Spirit', sameTarget: false, blurb: '' }],
      [NEXT_WEEK, { name: 'Polypoid', sameTarget: true, blurb: '' }],
    ])
    const options = featureWeekOptions(NOW, taken)
    expect(replacesText(options[0])).toBe('Replaces Fighting Spirit')
    expect(replacesText(options[1])).toBeUndefined()
    expect(replacesText(options[2])).toBeUndefined()
    expect(replacesText(undefined)).toBeUndefined()
  })

  test('marks a map as the map of the week while its newest week is the current one', () => {
    expect(featuredChip([], NOW)).toBeUndefined()
    expect(featuredChip(['2026-11-09T00:00:00Z', '2026-10-05T00:00:00Z'], NOW)).toEqual({
      current: true,
      week: new Date(THIS_WEEK),
    })
    expect(featuredChip(['2026-11-02T00:00:00Z'], NOW)?.current).toBe(false)
  })

  test('writes the map page chip with the newest week once it has passed', () => {
    const formatDate = (date: Date) => formatDayMonth(date) + ` ${date.getUTCFullYear()}`
    expect(featuredChipText([], NOW, formatDate, t)).toBeUndefined()
    expect(featuredChipText(['2026-11-09T00:00:00Z'], NOW, formatDate, t)).toBe('Map of the week')
    expect(featuredChipText(['2026-11-02T00:00:00Z'], NOW, formatDate, t)).toBe(
      'Map of the week · 2 Nov 2026',
    )
  })

  test('explains each error saving a pick', () => {
    for (const code of [
      'INVALID_WEEK',
      'WEEK_PASSED',
      'WEEK_TOO_FAR',
      'INVALID_BLURB',
      'NOT_LISTED',
      'NOT_PUBLIC',
      'NOT_FOUND',
      'FORBIDDEN',
      'BAD_REQUEST',
    ]) {
      expect(featureErrorText(code)).not.toBe(featureErrorText(undefined))
    }
    expect(featureErrorText('INVALID_BLURB')).toContain('400')
  })
})
