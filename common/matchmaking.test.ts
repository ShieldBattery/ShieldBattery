import { describe, expect, it } from 'vitest'
import { MatchmakingDivision, pointsToMatchmakingDivisionAndBounds } from './matchmaking'

describe('common/matchmaking', () => {
  describe('pointsToMatchmakingDivisionAndBounds', () => {
    it('works without bonus', () => {
      expect(pointsToMatchmakingDivisionAndBounds(true, 0, 0)).toEqual([
        MatchmakingDivision.Bronze1,
        0,
        800,
      ])
      expect(pointsToMatchmakingDivisionAndBounds(true, 799, 0)).toEqual([
        MatchmakingDivision.Bronze1,
        0,
        800,
      ])
      expect(pointsToMatchmakingDivisionAndBounds(true, 800, 0)).toEqual([
        MatchmakingDivision.Bronze2,
        800,
        1520,
      ])
      expect(pointsToMatchmakingDivisionAndBounds(true, 6560, 0)).toEqual([
        MatchmakingDivision.Platinum1,
        6560,
        6800,
      ])
    })

    it('works for team modes', () => {
      expect(pointsToMatchmakingDivisionAndBounds(false, 0, 0)).toEqual([
        MatchmakingDivision.Bronze1,
        0,
        700,
      ])
      expect(pointsToMatchmakingDivisionAndBounds(false, 699, 0)).toEqual([
        MatchmakingDivision.Bronze1,
        0,
        700,
      ])
      expect(pointsToMatchmakingDivisionAndBounds(false, 700, 0)).toEqual([
        MatchmakingDivision.Bronze2,
        700,
        1400,
      ])
      expect(pointsToMatchmakingDivisionAndBounds(false, 6300, 0)).toEqual([
        MatchmakingDivision.Platinum1,
        6300,
        6500,
      ])
    })

    it('works with bonus', () => {
      expect(pointsToMatchmakingDivisionAndBounds(true, 0, 2400)).toEqual([
        MatchmakingDivision.Bronze1,
        0,
        800,
      ])
      expect(pointsToMatchmakingDivisionAndBounds(true, 800, 2400)).toEqual([
        MatchmakingDivision.Bronze2,
        800,
        1520,
      ])
      // Silver 1 has a low factor of 0 so this still makes it in
      expect(pointsToMatchmakingDivisionAndBounds(true, 2240, 2400)).toEqual([
        MatchmakingDivision.Silver1,
        2240,
        2960 + 0.3 * 2400,
      ])
      // Silver 1 has a high factor of 0.3 so this doesn't make it into Silver 2
      expect(pointsToMatchmakingDivisionAndBounds(true, 2940, 2400)).toEqual([
        MatchmakingDivision.Silver1,
        2240,
        2960 + 0.3 * 2400,
      ])

      expect(pointsToMatchmakingDivisionAndBounds(true, 6560 + 0.6 * 2400 - 1, 2400)).toEqual([
        MatchmakingDivision.Gold3,
        5840 + 0.6 * 2400,
        6560 + 0.6 * 2400,
      ])
      expect(pointsToMatchmakingDivisionAndBounds(true, 6560 + 0.6 * 2400, 2400)).toEqual([
        MatchmakingDivision.Platinum1,
        6560 + 0.6 * 2400,
        6800 + 2400,
      ])
    })
  })
})
