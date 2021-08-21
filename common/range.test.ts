import { range } from './range'

describe('common/range', () => {
  test('steps by 1', () => {
    expect(Array.from(range(0, 5))).toEqual([0, 1, 2, 3, 4])
    expect(Array.from(range(5, 7))).toEqual([5, 6])
  })

  test('ends immediately if start === end', () => {
    expect(Array.from(range(5, 5))).toEqual([])
    expect(Array.from(range(5, 5, -1))).toEqual([])
  })

  test('handles counting downward', () => {
    expect(Array.from(range(5, 0))).toEqual([5, 4, 3, 2, 1])
  })

  test("handles end values that don't fall on a step", () => {
    expect(Array.from(range(0, 9, 2))).toEqual([0, 2, 4, 6, 8])
    expect(Array.from(range(9, 0, -2))).toEqual([9, 7, 5, 3, 1])
  })

  test("throws if parameters wouldn't make progress", () => {
    expect(() => Array.from(range(0, 5, -1))).toThrowErrorMatchingInlineSnapshot(
      `"range was passed parameters that do not make progress: [start: 0, end: 5, step: -1]"`,
    )
    expect(() => Array.from(range(5, 0, 1))).toThrowErrorMatchingInlineSnapshot(
      `"range was passed parameters that do not make progress: [start: 5, end: 0, step: 1]"`,
    )
  })
})
