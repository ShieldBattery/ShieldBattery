import { describe, expect, test } from 'vitest'
import { MatchmakingType } from '../../../common/matchmaking'
import {
  computeDivisionRatingOffset,
  computeDivisionRatingOffsets,
  DIVISION_RATING_OFFSET_MIN_USERS,
  OFFSET_MATCHMAKING_TYPES,
} from './division-rating-offsets'

function repeat(value: number, count: number): number[] {
  return Array.from({ length: count }, () => value)
}

describe('matchmaking/division-rating-offsets', () => {
  describe('computeDivisionRatingOffset', () => {
    test('is the median difference', () => {
      // Odd count: the middle value
      expect(computeDivisionRatingOffset([...repeat(100, 15), 150, ...repeat(400, 15)])).toBe(150)
      // Even count: the mean of the two middle values
      expect(computeDivisionRatingOffset([...repeat(100, 15), ...repeat(200, 15)])).toBe(150)
    })

    test('ignores the order of the differences', () => {
      const differences = [...repeat(300, 10), ...repeat(60, 11), ...repeat(80, 10)]
      expect(computeDivisionRatingOffset(differences)).toBe(80)
    })

    test('rounds to a whole number', () => {
      expect(computeDivisionRatingOffset([...repeat(120, 15), ...repeat(121, 15)])).toBe(121)
      expect(computeDivisionRatingOffset(repeat(87.3, 30))).toBe(87)
    })

    test('is 0 without enough users', () => {
      expect(computeDivisionRatingOffset([])).toBe(0)
      expect(computeDivisionRatingOffset(repeat(150, DIVISION_RATING_OFFSET_MIN_USERS - 1))).toBe(0)
      expect(computeDivisionRatingOffset(repeat(150, DIVISION_RATING_OFFSET_MIN_USERS))).toBe(150)
    })

    test('is 0 when the median is below the minimum offset', () => {
      expect(computeDivisionRatingOffset(repeat(49.9, 30))).toBe(0)
      expect(computeDivisionRatingOffset(repeat(50, 30))).toBe(50)
      // A mode rated higher than the reference isn't offset the other way
      expect(computeDivisionRatingOffset(repeat(-150, 30))).toBe(0)
    })
  })

  describe('computeDivisionRatingOffsets', () => {
    test('covers every team mode other than the reference', () => {
      expect(OFFSET_MATCHMAKING_TYPES).not.toContain(MatchmakingType.Match1v1)
      expect(OFFSET_MATCHMAKING_TYPES).not.toContain(MatchmakingType.Match1v1Fastest)
      expect(OFFSET_MATCHMAKING_TYPES).not.toContain(MatchmakingType.Match2v2)
      expect(OFFSET_MATCHMAKING_TYPES).toContain(MatchmakingType.Match2v2Bgh)
      expect(OFFSET_MATCHMAKING_TYPES).toContain(MatchmakingType.Match3v3Bgh)
    })

    test('computes each mode, with 0 for modes without differences', () => {
      const offsets = computeDivisionRatingOffsets(
        new Map([
          [MatchmakingType.Match3v3Bgh, repeat(150, 40)],
          [MatchmakingType.Match2v2Bgh, repeat(20, 40)],
        ]),
      )
      expect(Object.keys(offsets).sort()).toEqual([...OFFSET_MATCHMAKING_TYPES].sort())
      expect(offsets[MatchmakingType.Match3v3Bgh]).toBe(150)
      expect(offsets[MatchmakingType.Match2v2Bgh]).toBe(0)
      expect(offsets[MatchmakingType.Match3v3Hunters]).toBe(0)
    })
  })
})
