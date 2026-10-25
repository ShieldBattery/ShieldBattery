import { expect, test } from 'vitest'
import { banEvasionEndTime } from './ban-evasion'

const HOUR = 60 * 60 * 1000
const NOW = Date.UTC(2026, 9, 25)

test('doubles remaining time without rounding away partial hours', () => {
  expect(banEvasionEndTime(NOW, new Date(NOW + 1.25 * HOUR))).toEqual(new Date(NOW + 2.5 * HOUR))
})

test('clamps missing, expired, and short bans to one hour', () => {
  for (const end of [undefined, new Date(NOW - HOUR), new Date(NOW + 0.1 * HOUR)]) {
    expect(banEvasionEndTime(NOW, end)).toEqual(new Date(NOW + HOUR))
  }
})

test('caps permanent bans at one hundred years', () => {
  expect(banEvasionEndTime(NOW, new Date('9001-01-01T00:00:00Z'))).toEqual(
    new Date(NOW + 100 * 365 * 24 * HOUR),
  )
})
