import { describe, expect, test } from 'vitest'
import { decodeTerrainChanges } from './terrain-changes'

function encode(bytes: number[]) {
  return btoa(String.fromCharCode(...bytes))
}

describe('client/maps/terrain-changes', () => {
  test('reads the low bit of each byte first', () => {
    expect(decodeTerrainChanges(encode([0b0000_0101]), 8)).toEqual([0, 2])
  })

  test('continues into later bytes row-major', () => {
    expect(decodeTerrainChanges(encode([0x00, 0b1000_0001]), 16)).toEqual([8, 15])
  })

  test('ignores bits past the tile count', () => {
    expect(decodeTerrainChanges(encode([0xff]), 3)).toEqual([0, 1, 2])
  })

  test('tolerates data shorter than the tile count', () => {
    expect(decodeTerrainChanges(encode([0x01]), 64)).toEqual([0])
  })

  test('returns nothing for an empty mask', () => {
    expect(decodeTerrainChanges('', 16)).toEqual([])
  })
})
