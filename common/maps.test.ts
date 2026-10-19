import { describe, expect, test } from 'vitest'
import { mapImageSrcSet } from './maps'

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
