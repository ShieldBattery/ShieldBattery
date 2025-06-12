import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { multipleRandomItems, multipleRandomItemsUntil } from './random'

describe('common/random', () => {
  const origRandom = Math.random

  beforeEach(() => {
    const randomValues = [0.1, 0.1, 0.3, 0.5, 0.7]
    Math.random = vi.fn().mockImplementation(() => {
      const value = randomValues[0]
      randomValues.push(randomValues.shift()!)
      return value
    })
  })

  afterEach(() => {
    Math.random = origRandom
  })

  test('multipleRandomItems - does not return duplicates', () => {
    const items = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]

    const result = multipleRandomItems(9, items)
    const deduped = Array.from(new Set(result))
    expect(deduped).toHaveLength(9)
  })

  test('multipleRandomItems - works for returning a single item', () => {
    const items = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
    expect(multipleRandomItems(1, items)).toEqual([1])
  })

  test('multipleRandomItemsUntil - stops when function returns false', () => {
    const items = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
    expect(multipleRandomItemsUntil(items, r => r.length < 3)).toEqual([1, 0, 2])
  })

  test('multipleRandomItemsUntil - works for returning 0 items', () => {
    const items = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
    expect(multipleRandomItemsUntil(items, () => false)).toEqual([])
  })

  test('multipleRandomItemsUntil - works for returning the whole list', () => {
    const items = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
    const result = multipleRandomItemsUntil(items, () => true)
    const deduped = Array.from(new Set(result))
    expect(deduped).toHaveLength(10)
  })
})
