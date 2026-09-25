import { describe, expect, test } from 'vitest'
import { FetchBudget } from './fetch-budget'

describe('client/network/fetch-budget', () => {
  test('denies takes past the limit within a window', () => {
    const budget = new FetchBudget(2, 1000)
    expect(budget.take(10_000)).toBe(true)
    expect(budget.take(10_500)).toBe(true)
    expect(budget.take(10_999)).toBe(false)
  })

  test('a new window restores the budget', () => {
    const budget = new FetchBudget(1, 1000)
    expect(budget.take(10_000)).toBe(true)
    expect(budget.take(10_999)).toBe(false)
    expect(budget.take(11_000)).toBe(true)
    expect(budget.take(11_500)).toBe(false)
  })

  test('reset() restores the budget', () => {
    const budget = new FetchBudget(1, 1000)
    expect(budget.take(10_000)).toBe(true)
    expect(budget.take(10_001)).toBe(false)
    budget.reset()
    expect(budget.take(10_002)).toBe(true)
  })
})
