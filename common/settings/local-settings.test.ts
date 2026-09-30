import { describe, expect, test } from 'vitest'
import {
  GAME_WINDOW_PRESET_SIZES,
  hasSupportedGameWindowAspectRatio,
  MAX_GAME_WINDOW_SIZE,
  MIN_GAME_WINDOW_SIZE,
} from './local-settings'

describe('hasSupportedGameWindowAspectRatio', () => {
  test('allows 4:3, 16:9 and anything between', () => {
    expect(hasSupportedGameWindowAspectRatio({ width: 1280, height: 960 })).toBe(true)
    expect(hasSupportedGameWindowAspectRatio({ width: 1920, height: 1080 })).toBe(true)
    expect(hasSupportedGameWindowAspectRatio({ width: 1100, height: 700 })).toBe(true)
  })

  test('rejects anything taller than 4:3', () => {
    expect(hasSupportedGameWindowAspectRatio({ width: 900, height: 680 })).toBe(false)
    expect(hasSupportedGameWindowAspectRatio({ width: 700, height: 700 })).toBe(false)
  })

  test('rejects anything wider than 16:9', () => {
    expect(hasSupportedGameWindowAspectRatio({ width: 1600, height: 600 })).toBe(false)
    expect(hasSupportedGameWindowAspectRatio({ width: 1921, height: 1080 })).toBe(false)
  })

  test('allows every preset and the size limits', () => {
    for (const size of [...GAME_WINDOW_PRESET_SIZES, MIN_GAME_WINDOW_SIZE, MAX_GAME_WINDOW_SIZE]) {
      expect(hasSupportedGameWindowAspectRatio(size)).toBe(true)
    }
  })
})
