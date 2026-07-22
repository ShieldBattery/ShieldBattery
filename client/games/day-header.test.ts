import { describe, expect, test } from 'vitest'
import { resolveDateRangeMs } from './day-header'

describe('resolveDateRangeMs', () => {
  test('resolves both bounds to local start/end of day', () => {
    const { startMs, endMs } = resolveDateRangeMs('2026-07-01', '2026-07-21')

    expect(startMs).toBe(new Date(2026, 6, 1).getTime())
    expect(endMs).toBe(new Date(2026, 6, 22).getTime() - 1)
  })

  test('resolves only startDate when endDate is omitted', () => {
    const { startMs, endMs } = resolveDateRangeMs('2026-07-01', undefined)

    expect(startMs).toBe(new Date(2026, 6, 1).getTime())
    expect(endMs).toBeUndefined()
  })

  test('resolves only endDate when startDate is omitted', () => {
    const { startMs, endMs } = resolveDateRangeMs(undefined, '2026-07-21')

    expect(startMs).toBeUndefined()
    expect(endMs).toBe(new Date(2026, 6, 22).getTime() - 1)
  })

  test('both bounds undefined when both inputs are undefined', () => {
    const { startMs, endMs } = resolveDateRangeMs(undefined, undefined)

    expect(startMs).toBeUndefined()
    expect(endMs).toBeUndefined()
  })

  test('empty strings resolve to undefined bounds', () => {
    const { startMs, endMs } = resolveDateRangeMs('', '')

    expect(startMs).toBeUndefined()
    expect(endMs).toBeUndefined()
  })

  test('garbage input resolves to undefined, never NaN', () => {
    const { startMs, endMs } = resolveDateRangeMs('not-a-date', 'also-garbage')

    expect(startMs).toBeUndefined()
    expect(endMs).toBeUndefined()
    expect(Number.isNaN(startMs)).toBe(false)
    expect(Number.isNaN(endMs)).toBe(false)
  })

  test('a calendar date that does not exist resolves to undefined', () => {
    // Date would otherwise roll February 30th over into March.
    const { startMs, endMs } = resolveDateRangeMs('2026-02-30', '2026-02-30')

    expect(startMs).toBeUndefined()
    expect(endMs).toBeUndefined()
  })

  test('an out-of-range month resolves to undefined', () => {
    const { startMs } = resolveDateRangeMs('2026-13-01', undefined)

    expect(startMs).toBeUndefined()
  })

  test('parses as local time, not UTC (unlike bare `new Date(string)`)', () => {
    const { startMs } = resolveDateRangeMs('2026-07-01', undefined)

    // Constructing via `new Date(year, month, day)` (rather than passing the raw string through
    // to `Date`) is what makes this local time rather than UTC; the two would only coincide by
    // accident in a UTC-offset-zero test environment.
    expect(startMs).toBe(new Date(2026, 6, 1, 0, 0, 0, 0).getTime())
  })

  test('endMs is the last millisecond of the day, not midnight of the next day', () => {
    const { endMs } = resolveDateRangeMs(undefined, '2026-07-21')

    expect(endMs).toBe(new Date(2026, 6, 21, 23, 59, 59, 999).getTime())
  })
})
