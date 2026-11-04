import { describe, expect, test } from 'vitest'
import { mapTileDensities, mapTileUrl, parseMapTilePath, serverImageDensity } from './map-tiles'

describe('mapTileDensities', () => {
  test('renders 128-class maps at the native density', () => {
    expect(mapTileDensities(128, 128)).toEqual([32])
    expect(mapTileDensities(96, 128)).toEqual([32])
  })

  test('renders 256-class maps at the native density and half of it', () => {
    expect(mapTileDensities(256, 256)).toEqual([32, 16])
    expect(mapTileDensities(192, 192)).toEqual([32, 16])
  })

  test('has no tiles for maps the server image already shows at full detail', () => {
    expect(mapTileDensities(64, 64)).toEqual([])
    expect(mapTileDensities(64, 32)).toEqual([])
  })

  test('only has densities with more detail than the server image', () => {
    for (const size of [64, 96, 128, 192, 256]) {
      for (const density of mapTileDensities(size, size)) {
        expect(density).toBeGreaterThan(serverImageDensity(size, size))
      }
    }
  })
})

describe('serverImageDensity', () => {
  test('is a whole number of pixels per tile, at most native', () => {
    expect(serverImageDensity(256, 256)).toBe(8)
    expect(serverImageDensity(192, 192)).toBe(10)
    expect(serverImageDensity(128, 128)).toBe(16)
    expect(serverImageDensity(32, 32)).toBe(32)
  })
})

describe('parseMapTilePath', () => {
  const hash = 'ab'.repeat(32)

  test('reads back what mapTileUrl writes', () => {
    const tile = { hash, format: 'scx' as const, density: 16, x: 3, y: 12 }
    const url = new URL(mapTileUrl(tile))
    expect(parseMapTilePath(url.pathname.slice('/map-tile/'.length))).toEqual(tile)
  })

  test('rejects paths that name no tile', () => {
    expect(parseMapTilePath(`${hash}/scx/16/3`)).toBeUndefined()
    expect(parseMapTilePath(`${hash}/exe/16/3-4`)).toBeUndefined()
    expect(parseMapTilePath(`../${hash}/scx/16/3-4`)).toBeUndefined()
    expect(parseMapTilePath(`${hash.toUpperCase()}/scx/16/3-4`)).toBeUndefined()
  })
})
