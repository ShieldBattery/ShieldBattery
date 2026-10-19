import { describe, expect, test } from 'vitest'
import { GameType } from './games/game-type'
import { mapImageSrcSet, visibleSpawns } from './maps'

function imageInfo(width: number, height: number) {
  return {
    name: 'Map',
    image256Url: 'a-256',
    image512Url: 'a-512',
    image1024Url: 'a-1024',
    image2048Url: 'a-2048',
    mapData: { width, height },
  }
}

describe('common/maps/mapImageSrcSet', () => {
  test('square maps fill each size', () => {
    expect(mapImageSrcSet(imageInfo(128, 128))).toBe(
      'a-256 256w, a-512 512w, a-1024 1024w, a-2048 2048w',
    )
  })

  test('tall maps are narrower than each size', () => {
    expect(mapImageSrcSet(imageInfo(96, 128))).toBe(
      'a-256 192w, a-512 384w, a-1024 768w, a-2048 1536w',
    )
  })

  test('sizes that are not a multiple of the longest side round down', () => {
    expect(mapImageSrcSet(imageInfo(192, 192))).toBe(
      'a-256 192w, a-512 384w, a-1024 960w, a-2048 1920w',
    )
  })

  test('small maps stop at 32 pixels per tile without repeating a width', () => {
    expect(mapImageSrcSet(imageInfo(32, 32))).toBe('a-256 256w, a-512 512w, a-1024 1024w')
  })

  test('missing images are left out', () => {
    expect(mapImageSrcSet({ ...imageInfo(128, 128), image2048Url: undefined })).toBe(
      'a-256 256w, a-512 512w, a-1024 1024w',
    )
  })
})

describe('common/maps/visibleSpawns', () => {
  const startLocations = [
    { slot: 0, x: 256, y: 256 },
    { slot: 1, x: 3840, y: 3840 },
  ]
  function spawnInfo({
    umsContent = false,
    imageSpawnsBaked = false,
    locations = startLocations,
  }: {
    umsContent?: boolean
    imageSpawnsBaked?: boolean
    locations?: Array<{ slot: number; x: number; y: number }>
  } = {}) {
    return {
      name: 'Map',
      imageSpawnsBaked,
      mapData: { width: 128, height: 128, startLocations: locations, umsContent },
    }
  }

  test('melee maps show their start locations', () => {
    expect(visibleSpawns(spawnInfo())).toEqual(startLocations)
  })

  test('maps with UMS content show none outside a game', () => {
    expect(visibleSpawns(spawnInfo({ umsContent: true }))).toEqual([])
  })

  test('melee game types show them even on maps with UMS content', () => {
    expect(visibleSpawns(spawnInfo({ umsContent: true }), GameType.Melee)).toEqual(startLocations)
    expect(visibleSpawns(spawnInfo({ umsContent: true }), GameType.TopVsBottom)).toEqual(
      startLocations,
    )
  })

  test('UMS games show none', () => {
    expect(visibleSpawns(spawnInfo(), GameType.UseMapSettings)).toEqual([])
  })

  test('images with spawns drawn in, or unknown images, show none', () => {
    expect(visibleSpawns(spawnInfo({ imageSpawnsBaked: true }))).toEqual([])
    const { imageSpawnsBaked: _, ...unknown } = spawnInfo()
    expect(visibleSpawns(unknown)).toEqual([])
  })

  test('start locations off the map are dropped', () => {
    const offMap = { slot: 2, x: 5000, y: 100 }
    expect(visibleSpawns(spawnInfo({ locations: [...startLocations, offMap] }))).toEqual(
      startLocations,
    )
  })
})
