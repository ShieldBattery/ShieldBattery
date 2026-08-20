import { describe, expect, test } from 'vitest'
import { counterVisibleAt } from './input-counter'

describe('material/input-counter/counterVisibleAt', () => {
  test('short limits show the counter once 80% is used', () => {
    // A floor of the fraction math would give 4 here (0.2 is not exactly representable), which
    // would shift the boundary by a character
    expect(counterVisibleAt(25)).toBe(5)
    expect(counterVisibleAt(30)).toBe(6)
    expect(counterVisibleAt(50)).toBe(10)
    expect(counterVisibleAt(210)).toBe(42)
  })

  test('long limits cap at 200 remaining', () => {
    expect(counterVisibleAt(1000)).toBe(200)
    expect(counterVisibleAt(2000)).toBe(200)
    expect(counterVisibleAt(10000)).toBe(200)
  })

  test('the cap takes over exactly at a 1000-character limit', () => {
    expect(counterVisibleAt(999)).toBe(200)
    expect(counterVisibleAt(1001)).toBe(200)
    expect(counterVisibleAt(995)).toBe(199)
  })
})
