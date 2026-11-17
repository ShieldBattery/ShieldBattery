import { describe, expect, test } from 'vitest'
import { nextWeekStartAfter, weekDateString, weekStartOf } from './map-feature-weeks'

describe('common/map-feature-weeks', () => {
  test('starts weeks on Monday at 00:00 UTC', () => {
    expect(weekStartOf(Date.parse('2026-11-12T13:00:00Z')).toISOString()).toBe(
      '2026-11-09T00:00:00.000Z',
    )
    expect(weekStartOf(Date.parse('2027-01-01T12:00:00Z')).toISOString()).toBe(
      '2026-12-28T00:00:00.000Z',
    )
  })

  test('a Monday at exactly 00:00 UTC starts its own week', () => {
    expect(weekStartOf(Date.parse('2026-11-09T00:00:00.000Z')).toISOString()).toBe(
      '2026-11-09T00:00:00.000Z',
    )
    expect(nextWeekStartAfter(Date.parse('2026-11-09T00:00:00.000Z')).toISOString()).toBe(
      '2026-11-16T00:00:00.000Z',
    )
  })

  test('the last instant of Sunday is still in the week that started on Monday', () => {
    const sunday = Date.parse('2026-11-15T23:59:59.999Z')
    expect(weekStartOf(sunday).toISOString()).toBe('2026-11-09T00:00:00.000Z')
    expect(nextWeekStartAfter(sunday).toISOString()).toBe('2026-11-16T00:00:00.000Z')
    expect(weekStartOf(sunday + 1).toISOString()).toBe('2026-11-16T00:00:00.000Z')
  })

  test('takes Dates as well as timestamps', () => {
    expect(weekStartOf(new Date('2026-11-11T08:00:00Z')).toISOString()).toBe(
      '2026-11-09T00:00:00.000Z',
    )
    expect(nextWeekStartAfter(new Date('2026-12-30T08:00:00Z')).toISOString()).toBe(
      '2027-01-04T00:00:00.000Z',
    )
  })

  test('writes a week as the date it starts', () => {
    expect(weekDateString(weekStartOf(Date.parse('2026-11-15T23:59:59.999Z')))).toBe('2026-11-09')
  })
})
