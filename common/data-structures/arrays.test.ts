import { binarySearch, concatWithoutDuplicates, findLastIndex } from './arrays'

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

  test('binarySearch', () => {
    expect(binarySearch([], 1, (e, v) => e - v)).toBe(-1)
    expect(binarySearch([1, 3, 5, 7, 9], 3, (e, v) => e - v)).toBe(1)
    expect(binarySearch([1, 3, 5, 7, 9], 4, (e, v) => e - v)).toBe(-1)
    expect(binarySearch([1, 3, 5, 7, 9], 1, (e, v) => e - v)).toBe(0)
    expect(binarySearch([1, 3, 5, 7, 9], 5, (e, v) => e - v)).toBe(2)
    expect(binarySearch([1, 3, 5, 7, 9], 9, (e, v) => e - v)).toBe(4)
    expect(binarySearch([1, 3, 5, 7, 9], 10, (e, v) => e - v)).toBe(-1)
    expect(binarySearch([1, 3, 5, 7, 9], 0, (e, v) => e - v)).toBe(-1)
  })

  test('concatWithoutDuplicates', () => {
    expect(concatWithoutDuplicates([], [])).toEqual([])
    expect(concatWithoutDuplicates([1, 2], [3, 4])).toEqual([1, 2, 3, 4])
    expect(concatWithoutDuplicates([1, 2], [2, 3])).toEqual([1, 2, 3])
    expect(concatWithoutDuplicates([4, 2, 1, 2], [1, 3, 4, 2])).toEqual([4, 2, 1, 3])
    expect(concatWithoutDuplicates([{ id: 1 }], [], value => value.id)).toEqual([{ id: 1 }])
    expect(concatWithoutDuplicates([{ id: 1 }], [{ id: 1 }], value => value.id)).toEqual([
      { id: 1 },
    ])
    expect(concatWithoutDuplicates([{ id: 1 }], [{ id: 2 }], value => value.id)).toEqual([
      { id: 1 },
      { id: 2 },
    ])
    expect(
      concatWithoutDuplicates([{ id: 1 }, { id: 2 }], [{ id: 2 }, { id: 3 }], value => value.id),
    ).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }])
  })
})
