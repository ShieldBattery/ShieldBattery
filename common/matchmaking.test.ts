import { describe, expect, it } from 'vitest'
import { MatchmakingDivision, pointsToMatchmakingDivisionAndBounds } from './matchmaking'

describe('common/matchmaking', () => {
  describe('pointsToMatchmakingDivisionAndBounds', () => {
    it('works without bonus', () => {
      expect(pointsToMatchmakingDivisionAndBounds(0, 0)).toEqual([
        MatchmakingDivision.Bronze1,
        0,
        750,
      ])
      expect(pointsToMatchmakingDivisionAndBounds(749, 0)).toEqual([
        MatchmakingDivision.Bronze1,
        0,
        750,
      ])
      expect(pointsToMatchmakingDivisionAndBounds(750, 0)).toEqual([
        MatchmakingDivision.Bronze2,
        750,
        1500,
      ])
      expect(pointsToMatchmakingDivisionAndBounds(6750, 0)).toEqual([
        MatchmakingDivision.Platinum1,
        6750,
        7070,
      ])
    })

    it('works with bonus', () => {
      expect(pointsToMatchmakingDivisionAndBounds(0, 2400)).toEqual([
        MatchmakingDivision.Bronze1,
        0,
        750,
      ])
      expect(pointsToMatchmakingDivisionAndBounds(750, 2400)).toEqual([
        MatchmakingDivision.Bronze2,
        750,
        1500,
      ])
      // Silver 1 has a low factor of 0 so this still makes it in
      expect(pointsToMatchmakingDivisionAndBounds(2250, 2400)).toEqual([
        MatchmakingDivision.Silver1,
        2250,
        3720,
      ])
      // Silver 1 has a high factor of 0.3 so this doesn't make it into Silver 2
      expect(pointsToMatchmakingDivisionAndBounds(3700, 2400)).toEqual([
        MatchmakingDivision.Silver1,
        2250,
        3720,
      ])

      expect(pointsToMatchmakingDivisionAndBounds(6000 + 2190 - 1, 2400)).toEqual([
        MatchmakingDivision.Gold3,
        5250 + 2190,
        6000 + 2190,
      ])
      expect(pointsToMatchmakingDivisionAndBounds(6000 + 2190, 2400)).toEqual([
        MatchmakingDivision.Platinum1,
        6000 + 2190,
        6750 + 2720,
      ])
    })
  })
})
