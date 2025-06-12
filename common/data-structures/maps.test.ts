import { describe, expect, test } from 'vitest'
import { appendToMultimap, cloneMultimap, mergeMultimaps, prependToMultimap } from './maps'

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

  test('mergeMultimaps', () => {
    const mapA = new Map<string, number[]>()
    const mapB = new Map<string, number[]>()

    appendToMultimap(mapA, 'key1', 1)
    appendToMultimap(mapA, 'key1', 2)
    appendToMultimap(mapA, 'key2', 3)
    appendToMultimap(mapB, 'key2', 4)
    appendToMultimap(mapB, 'key3', 5)
    appendToMultimap(mapB, 'key3', 6)

    const merged = mergeMultimaps(mapA, mapB)

    expect(merged.get('key1')).toEqual([1, 2])
    expect(merged.get('key2')).toEqual([3, 4])
    expect(merged.get('key3')).toEqual([5, 6])

    // Ensure that the arrays were copied and aren't shared with the original maps
    mapA.get('key1')!.push(0)
    expect(merged.get('key1')).toEqual([1, 2])
    mapA.get('key2')!.push(0)
    expect(merged.get('key2')).toEqual([3, 4])
    mapB.get('key2')!.push(0)
    expect(merged.get('key2')).toEqual([3, 4])
    mapB.get('key3')!.push(0)
    expect(merged.get('key3')).toEqual([5, 6])
  })

  test('cloneMultimap', () => {
    const map = new Map<string, number[]>()

    appendToMultimap(map, 'key1', 1)
    appendToMultimap(map, 'key1', 2)
    appendToMultimap(map, 'key2', 3)

    const cloned = cloneMultimap(map)

    expect(cloned.get('key1')).toEqual([1, 2])
    expect(cloned.get('key2')).toEqual([3])

    // Ensure that the arrays were copied and aren't shared with the original map
    map.get('key1')!.push(0)
    expect(cloned.get('key1')).toEqual([1, 2])
  })
})
