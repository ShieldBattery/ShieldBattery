import { intersection, subtract, union } from './sets'

const EMPTY = new Set<number>()
const LOW = new Set([0, 1, 2, 3])
const MID = new Set([3, 4, 5, 6])
const HIGH = new Set([6, 7, 8, 9])

describe('common/sets', () => {
  test('union', () => {
    expect(union(EMPTY, EMPTY)).toEqual(EMPTY)
    expect(union(EMPTY, LOW)).toEqual(LOW)
    expect(union(LOW, LOW)).toEqual(LOW)

    const lowHigh = new Set([0, 1, 2, 3, 6, 7, 8, 9])
    expect(union(LOW, HIGH)).toEqual(lowHigh)
  })

  test('intersection', () => {
    expect(intersection(EMPTY, EMPTY)).toEqual(EMPTY)
    expect(intersection(EMPTY, LOW)).toEqual(EMPTY)
    expect(intersection(LOW, LOW)).toEqual(LOW)
    expect(intersection(LOW, HIGH)).toEqual(EMPTY)
    expect(intersection(LOW, MID)).toEqual(new Set([3]))
  })

  test('subtract', () => {
    expect(subtract(EMPTY, EMPTY)).toEqual(EMPTY)
    expect(subtract(LOW, EMPTY)).toEqual(LOW)
    expect(subtract(LOW, LOW)).toEqual(EMPTY)
    expect(subtract(HIGH, LOW)).toEqual(HIGH)
    expect(subtract(HIGH, MID)).toEqual(new Set([7, 8, 9]))
  })
})
