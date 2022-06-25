import { appendToMultimap, prependToMultimap } from './maps'

describe('common/maps', () => {
  test('appendToMultimap', () => {
    const map = new Map<string, number[]>()

    appendToMultimap(map, 'key', 1)
    expect(map.get('key')![0]).toBe(1)

    appendToMultimap(map, 'key', 2)
    expect(map.get('key')![0]).toBe(1)
    expect(map.get('key')![1]).toBe(2)
  })

  test('prependToMultimap', () => {
    const map = new Map<string, number[]>()

    prependToMultimap(map, 'key', 1)
    expect(map.get('key')![0]).toBe(1)

    prependToMultimap(map, 'key', 2)
    expect(map.get('key')![0]).toBe(2)
    expect(map.get('key')![1]).toBe(1)
  })
})
