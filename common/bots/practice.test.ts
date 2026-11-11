import { describe, expect, test } from 'vitest'
import { canPlayPracticeRace, resolvePracticeRace } from './practice'

describe('canPlayPracticeRace', () => {
  test('allows the races a bot plays', () => {
    expect(canPlayPracticeRace(['zerg', 'terran'], 'terran')).toBe(true)
    expect(canPlayPracticeRace(['zerg', 'terran'], 'protoss')).toBe(false)
  })

  test('allows random only for a bot that plays every race', () => {
    expect(canPlayPracticeRace(['protoss', 'zerg', 'terran'], 'random')).toBe(true)
    expect(canPlayPracticeRace(['zerg', 'terran'], 'random')).toBe(false)
  })
})

describe('resolvePracticeRace', () => {
  test('keeps a concrete race', () => {
    expect(resolvePracticeRace('protoss', () => 0)).toBe('protoss')
  })

  test('draws every race for random', () => {
    expect(resolvePracticeRace('random', () => 0)).toBe('zerg')
    expect(resolvePracticeRace('random', () => 0.5)).toBe('terran')
    expect(resolvePracticeRace('random', () => 0.99)).toBe('protoss')
  })
})
