import { appendToMapArray, prependToMapArray } from './maps'

describe('common/maps', () => {
  test('appendToMapArray', () => {
    const map = new Map<string, number[]>()

    appendToMapArray(map, 'key', 1)
    expect(map.get('key')![0]).toBe(1)

    appendToMapArray(map, 'key', 2)
    expect(map.get('key')![0]).toBe(1)
    expect(map.get('key')![1]).toBe(2)
  })

  test('prependToMapArray', () => {
    const map = new Map<string, number[]>()

    prependToMapArray(map, 'key', 1)
    expect(map.get('key')![0]).toBe(1)

    prependToMapArray(map, 'key', 2)
    expect(map.get('key')![0]).toBe(2)
    expect(map.get('key')![1]).toBe(1)
  })
})
