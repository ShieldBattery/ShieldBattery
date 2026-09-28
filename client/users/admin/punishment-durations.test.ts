import { describe, expect, test } from 'vitest'
import { presetEndTime, PunishmentDuration } from './punishment-durations'

describe('client/users/admin/punishment-durations', () => {
  const now = new Date(2026, 0, 15, 10, 30).getTime()

  test('fixed lengths add their exact duration', () => {
    expect(presetEndTime(PunishmentDuration.ThirtyMinutes, now)).toBe(now + 30 * 60 * 1000)
    expect(presetEndTime(PunishmentDuration.OneHour, now)).toBe(now + 60 * 60 * 1000)
    expect(presetEndTime(PunishmentDuration.OneDay, now)).toBe(now + 24 * 60 * 60 * 1000)
    expect(presetEndTime(PunishmentDuration.ThreeWeeks, now)).toBe(now + 21 * 24 * 60 * 60 * 1000)
  })

  test('month and year lengths keep the local day and time', () => {
    expect(presetEndTime(PunishmentDuration.OneMonth, now)).toBe(
      new Date(2026, 1, 15, 10, 30).getTime(),
    )
    expect(presetEndTime(PunishmentDuration.ThreeMonths, now)).toBe(
      new Date(2026, 3, 15, 10, 30).getTime(),
    )
    expect(presetEndTime(PunishmentDuration.SixMonths, now)).toBe(
      new Date(2026, 6, 15, 10, 30).getTime(),
    )
    expect(presetEndTime(PunishmentDuration.OneYear, now)).toBe(
      new Date(2027, 0, 15, 10, 30).getTime(),
    )
  })

  test('month lengths clamp to the last day of a shorter month', () => {
    const endOfJanuary = new Date(2026, 0, 31, 12, 0).getTime()
    expect(presetEndTime(PunishmentDuration.OneMonth, endOfJanuary)).toBe(
      new Date(2026, 1, 28, 12, 0).getTime(),
    )
  })
})
