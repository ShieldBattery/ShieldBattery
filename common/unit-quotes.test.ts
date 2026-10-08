import { describe, expect, test } from 'vitest'
import { QUOTE_UNITS, RETIRED_UNIT_QUOTES, UNIT_QUOTES } from './unit-quotes'

describe('common/unit-quotes', () => {
  test('every unit is named as a single lower-case word, the way it is typed', () => {
    for (const unit of QUOTE_UNITS) {
      expect(unit).toMatch(/^[a-z]+$/)
    }
  })

  test('every unit has at least one line to quote', () => {
    for (const unit of QUOTE_UNITS) {
      expect(UNIT_QUOTES[unit].length).toBeGreaterThan(0)
    }
  })

  test('a unit never lists the same line key twice', () => {
    for (const unit of QUOTE_UNITS) {
      const lines = UNIT_QUOTES[unit]
      expect(new Set<string>(lines).size).toBe(lines.length)
    }
  })

  test('a retired line is never one /quote still picks for the same unit', () => {
    for (const [unit, retired] of Object.entries(RETIRED_UNIT_QUOTES)) {
      const current = new Set<string>(
        (UNIT_QUOTES as Record<string, readonly string[]>)[unit] ?? [],
      )
      for (const line of retired) {
        expect(current.has(line)).toBe(false)
      }
    }
  })
})
