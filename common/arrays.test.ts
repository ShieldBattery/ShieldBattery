import { findLastIndex } from './arrays'

const makeCallbackFn = (searchValue: number) => (value: number) => value === searchValue

describe('common/arrays', () => {
  test('findLastIndex', () => {
    expect(findLastIndex([], makeCallbackFn(1))).toBe(-1)
    expect(findLastIndex([1], makeCallbackFn(1))).toBe(0)
    expect(findLastIndex([1, 2, 3], makeCallbackFn(1))).toBe(0)
    expect(findLastIndex([1, 2, 3], makeCallbackFn(2))).toBe(1)
    expect(findLastIndex([1, 2, 3], makeCallbackFn(3))).toBe(2)
    expect(findLastIndex([1, 2, 3], makeCallbackFn(4))).toBe(-1)
    expect(findLastIndex([1, 1, 1], makeCallbackFn(1))).toBe(2)
    expect(findLastIndex([1, 2, 1, 2], makeCallbackFn(1))).toBe(2)
  })
})
