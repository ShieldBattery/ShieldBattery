import { describe, expect, it } from 'vitest'
import {
  ALL_MATCHMAKING_TYPES,
  defaultPreferenceData,
  hasVetoes,
  isSoloType,
  MATCHMAKING_MODES,
  MatchmakingDivision,
  MatchmakingType,
  matchmakingTypeToLabel,
  pointsToMatchmakingDivisionAndBounds,
  TEAM_SIZES,
} from './matchmaking'

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

  describe('mode descriptors', () => {
    it('has an entry for every matchmaking type, keyed correctly', () => {
      for (const type of ALL_MATCHMAKING_TYPES) {
        expect(MATCHMAKING_MODES[type]).toBeDefined()
        expect(MATCHMAKING_MODES[type].type).toBe(type)
      }
    })

    it('derives TEAM_SIZES from the registry', () => {
      expect(TEAM_SIZES[MatchmakingType.Match1v1]).toBe(1)
      expect(TEAM_SIZES[MatchmakingType.Match1v1Fastest]).toBe(1)
      expect(TEAM_SIZES[MatchmakingType.Match2v2]).toBe(2)
    })

    it('derives hasVetoes from map selection style', () => {
      expect(hasVetoes(MatchmakingType.Match1v1)).toBe(true)
      expect(hasVetoes(MatchmakingType.Match2v2)).toBe(true)
      expect(hasVetoes(MatchmakingType.Match1v1Fastest)).toBe(false)
    })

    it('derives isSoloType from team size', () => {
      expect(isSoloType(MatchmakingType.Match1v1)).toBe(true)
      expect(isSoloType(MatchmakingType.Match1v1Fastest)).toBe(true)
      expect(isSoloType(MatchmakingType.Match2v2)).toBe(false)
    })

    it('returns default labels without a t function', () => {
      expect(matchmakingTypeToLabel(MatchmakingType.Match1v1, undefined as any)).toBe('1v1')
      expect(matchmakingTypeToLabel(MatchmakingType.Match1v1Fastest, undefined as any)).toBe(
        '1v1 Fastest',
      )
      expect(matchmakingTypeToLabel(MatchmakingType.Match2v2, undefined as any)).toBe('2v2')
    })

    it('provides alternate-race default data only for solo modes', () => {
      expect(defaultPreferenceData(MatchmakingType.Match1v1)).toEqual({
        useAlternateRace: false,
        alternateRace: 'z',
      })
      expect(defaultPreferenceData(MatchmakingType.Match1v1Fastest)).toEqual({
        useAlternateRace: false,
        alternateRace: 'z',
      })
      expect(defaultPreferenceData(MatchmakingType.Match2v2)).toEqual({})
    })
  })
})
