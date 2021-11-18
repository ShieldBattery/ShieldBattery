import { mockRandomForEach } from 'jest-mock-random'
import { multipleRandomItems } from './random'

describe('common/random', () => {
  mockRandomForEach([0.1, 0.1, 0.3, 0.5, 0.7])

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
})
