import { describe, expect, test } from 'vitest'
import { reorderPlaylistEntries } from './playlist-order'

describe('app/replay-library/playlist-order/reorderPlaylistEntries', () => {
  test('moves an entry earlier in the order', () => {
    expect(reorderPlaylistEntries([1, 2, 3, 4], 4, 1)).toEqual([1, 4, 2, 3])
  })

  test('moves an entry later in the order', () => {
    expect(reorderPlaylistEntries([1, 2, 3, 4], 1, 2)).toEqual([2, 3, 1, 4])
  })

  test('clamps a negative index to the start', () => {
    expect(reorderPlaylistEntries([1, 2, 3], 3, -5)).toEqual([3, 1, 2])
  })

  test('clamps an out-of-range index to the end', () => {
    expect(reorderPlaylistEntries([1, 2, 3], 1, 99)).toEqual([2, 3, 1])
  })

  test('is a no-op (aside from returning a copy) if the id is not present', () => {
    const ids = [1, 2, 3]
    const result = reorderPlaylistEntries(ids, 99, 0)
    expect(result).toEqual([1, 2, 3])
    expect(result).not.toBe(ids)
  })

  test('moving to its own index leaves the order unchanged', () => {
    expect(reorderPlaylistEntries([1, 2, 3], 2, 1)).toEqual([1, 2, 3])
  })
})
