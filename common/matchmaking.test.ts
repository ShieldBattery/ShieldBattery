import { describe, expect, it } from 'vitest'
import {
  ALL_MATCHMAKING_TYPES,
  defaultPreferenceData,
  DivisionContext,
  getDivisionBeforeRatingChange,
  getDivisionContext,
  getMatchmakingTypesForFormat,
  hasVetoes,
  isSoloType,
  makeSeasonId,
  MATCHMAKING_MODES,
  MatchmakingDivision,
  MatchmakingType,
  matchmakingTypeToLabel,
  pointsToMatchmakingDivision,
  pointsToMatchmakingDivisionAndBounds,
  TEAM_SIZES,
} from './matchmaking'

const SOLO = true
const TEAM = false

function ctx(bonusPool: number): DivisionContext {
  return { bonusPool }
}

describe('common/matchmaking', () => {
  describe('pointsToMatchmakingDivisionAndBounds', () => {
    it('works without bonus', () => {
      expect(pointsToMatchmakingDivisionAndBounds(SOLO, 0, ctx(0))).toEqual([
        MatchmakingDivision.Bronze1,
        0,
        800,
      ])
      expect(pointsToMatchmakingDivisionAndBounds(SOLO, 799, ctx(0))).toEqual([
        MatchmakingDivision.Bronze1,
        0,
        800,
      ])
      expect(pointsToMatchmakingDivisionAndBounds(SOLO, 800, ctx(0))).toEqual([
        MatchmakingDivision.Bronze2,
        800,
        1600,
      ])
      expect(pointsToMatchmakingDivisionAndBounds(SOLO, 6560, ctx(0))).toEqual([
        MatchmakingDivision.Platinum1,
        6560,
        6880,
      ])
    })

    it('works for team modes', () => {
      expect(pointsToMatchmakingDivisionAndBounds(TEAM, 0, ctx(0))).toEqual([
        MatchmakingDivision.Bronze1,
        0,
        860,
      ])
      expect(pointsToMatchmakingDivisionAndBounds(TEAM, 859, ctx(0))).toEqual([
        MatchmakingDivision.Bronze1,
        0,
        860,
      ])
      expect(pointsToMatchmakingDivisionAndBounds(TEAM, 860, ctx(0))).toEqual([
        MatchmakingDivision.Bronze2,
        860,
        1710,
      ])
      expect(pointsToMatchmakingDivisionAndBounds(TEAM, 6720, ctx(0))).toEqual([
        MatchmakingDivision.Platinum1,
        6720,
        6960,
      ])
    })

    it('works with bonus', () => {
      expect(pointsToMatchmakingDivisionAndBounds(SOLO, 0, ctx(2400))).toEqual([
        MatchmakingDivision.Bronze1,
        0,
        800,
      ])
      expect(pointsToMatchmakingDivisionAndBounds(SOLO, 800, ctx(2400))).toEqual([
        MatchmakingDivision.Bronze2,
        800,
        1600,
      ])
      // Silver 1 has a low factor of 0 so this still makes it in
      expect(pointsToMatchmakingDivisionAndBounds(SOLO, 2400, ctx(2400))).toEqual([
        MatchmakingDivision.Silver1,
        2400,
        4400 + 0.75 * 2400,
      ])
      // Silver 1 has a high factor of 0.75 so this doesn't make it into Silver 2
      expect(pointsToMatchmakingDivisionAndBounds(SOLO, 4400 + 0.75 * 2400 - 1, ctx(2400))).toEqual(
        [MatchmakingDivision.Silver1, 2400, 4400 + 0.75 * 2400],
      )

      expect(pointsToMatchmakingDivisionAndBounds(SOLO, 5600 + 2400 - 1, ctx(2400))).toEqual([
        MatchmakingDivision.Silver3,
        5000 + 2400,
        5600 + 2400,
      ])
      expect(pointsToMatchmakingDivisionAndBounds(SOLO, 5600 + 2400, ctx(2400))).toEqual([
        MatchmakingDivision.Gold1,
        5600 + 2400,
        5920 + 2400,
      ])
    })
  })

  describe('division table versions', () => {
    const v1 = (bonusPool: number): DivisionContext => ({ bonusPool, tableVersion: 1 })

    it('places points with the version 1 bounds', () => {
      expect(pointsToMatchmakingDivisionAndBounds(SOLO, 4400, v1(0))).toEqual([
        MatchmakingDivision.Gold1,
        4400,
        5120,
      ])
      expect(pointsToMatchmakingDivisionAndBounds(SOLO, 4400, ctx(0))).toEqual([
        MatchmakingDivision.Silver2,
        4400,
        5000,
      ])
      expect(pointsToMatchmakingDivisionAndBounds(TEAM, 4200, v1(0))).toEqual([
        MatchmakingDivision.Gold1,
        4200,
        4900,
      ])
    })

    it('applies the version 1 bonus factors', () => {
      expect(pointsToMatchmakingDivisionAndBounds(SOLO, 5000, v1(1000))).toEqual([
        MatchmakingDivision.Gold1,
        4400 + 0.3 * 1000,
        5120 + 0.6 * 1000,
      ])
    })

    it("is taken from the season's version by getDivisionContext", () => {
      const season = {
        id: makeSeasonId(1),
        name: 'Season',
        startDate: 0,
        resetMmr: false,
        divisionTableVersion: 1 as const,
      }
      const context = getDivisionContext(new Date(0), season)
      expect(context.tableVersion).toBe(1)
      expect(pointsToMatchmakingDivision(SOLO, 4400, context)).toBe(MatchmakingDivision.Gold1)
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
      expect(TEAM_SIZES[MatchmakingType.Match2v2Bgh]).toBe(2)
      expect(TEAM_SIZES[MatchmakingType.Match2v2Hunters]).toBe(2)
      expect(TEAM_SIZES[MatchmakingType.Match2v2Fastest]).toBe(2)
      expect(TEAM_SIZES[MatchmakingType.Match3v3Bgh]).toBe(3)
      expect(TEAM_SIZES[MatchmakingType.Match3v3Hunters]).toBe(3)
      expect(TEAM_SIZES[MatchmakingType.Match3v3Fastest]).toBe(3)
    })

    it('derives hasVetoes from map selection style', () => {
      expect(hasVetoes(MatchmakingType.Match1v1)).toBe(true)
      expect(hasVetoes(MatchmakingType.Match2v2)).toBe(true)
      expect(hasVetoes(MatchmakingType.Match1v1Fastest)).toBe(false)
      // Fixed-map and pick modes don't use vetoes.
      expect(hasVetoes(MatchmakingType.Match2v2Bgh)).toBe(false)
      expect(hasVetoes(MatchmakingType.Match2v2Hunters)).toBe(false)
      expect(hasVetoes(MatchmakingType.Match2v2Fastest)).toBe(false)
      expect(hasVetoes(MatchmakingType.Match3v3Bgh)).toBe(false)
      expect(hasVetoes(MatchmakingType.Match3v3Hunters)).toBe(false)
      expect(hasVetoes(MatchmakingType.Match3v3Fastest)).toBe(false)
    })

    it('marks fixed-map modes with the fixed selection style', () => {
      expect(MATCHMAKING_MODES[MatchmakingType.Match2v2Bgh].mapSelectionStyle).toBe('fixed')
      expect(MATCHMAKING_MODES[MatchmakingType.Match2v2Hunters].mapSelectionStyle).toBe('fixed')
      expect(MATCHMAKING_MODES[MatchmakingType.Match3v3Bgh].mapSelectionStyle).toBe('fixed')
      expect(MATCHMAKING_MODES[MatchmakingType.Match3v3Hunters].mapSelectionStyle).toBe('fixed')
    })

    it('marks Fastest modes with the pick selection style', () => {
      expect(MATCHMAKING_MODES[MatchmakingType.Match1v1Fastest].mapSelectionStyle).toBe('pick')
      expect(MATCHMAKING_MODES[MatchmakingType.Match2v2Fastest].mapSelectionStyle).toBe('pick')
      expect(MATCHMAKING_MODES[MatchmakingType.Match3v3Fastest].mapSelectionStyle).toBe('pick')
    })

    it('groups types by format in canonical order', () => {
      expect(getMatchmakingTypesForFormat('1v1')).toEqual([
        MatchmakingType.Match1v1,
        MatchmakingType.Match1v1Fastest,
      ])
      expect(getMatchmakingTypesForFormat('2v2')).toEqual([
        MatchmakingType.Match2v2,
        MatchmakingType.Match2v2Bgh,
        MatchmakingType.Match2v2Hunters,
        MatchmakingType.Match2v2Fastest,
      ])
      expect(getMatchmakingTypesForFormat('3v3')).toEqual([
        MatchmakingType.Match3v3Bgh,
        MatchmakingType.Match3v3Hunters,
        MatchmakingType.Match3v3Fastest,
      ])
    })

    it('derives isSoloType from team size', () => {
      expect(isSoloType(MatchmakingType.Match1v1)).toBe(true)
      expect(isSoloType(MatchmakingType.Match1v1Fastest)).toBe(true)
      expect(isSoloType(MatchmakingType.Match2v2)).toBe(false)
      expect(isSoloType(MatchmakingType.Match2v2Bgh)).toBe(false)
      expect(isSoloType(MatchmakingType.Match2v2Hunters)).toBe(false)
      expect(isSoloType(MatchmakingType.Match2v2Fastest)).toBe(false)
      expect(isSoloType(MatchmakingType.Match3v3Bgh)).toBe(false)
      expect(isSoloType(MatchmakingType.Match3v3Hunters)).toBe(false)
      expect(isSoloType(MatchmakingType.Match3v3Fastest)).toBe(false)
    })

    it('renders the English label from the i18n default value', () => {
      // A `t` that returns the default value (its second arg), like i18next with no translation loaded.
      const useDefault = ((_key: string, defaultValue: string) => defaultValue) as any
      expect(matchmakingTypeToLabel(MatchmakingType.Match1v1, useDefault)).toBe('1v1')
      expect(matchmakingTypeToLabel(MatchmakingType.Match1v1Fastest, useDefault)).toBe(
        '1v1 Fastest',
      )
      expect(matchmakingTypeToLabel(MatchmakingType.Match2v2, useDefault)).toBe('2v2')
      expect(matchmakingTypeToLabel(MatchmakingType.Match2v2Bgh, useDefault)).toBe('2v2 BGH')
      expect(matchmakingTypeToLabel(MatchmakingType.Match2v2Hunters, useDefault)).toBe(
        '2v2 Hunters',
      )
      expect(matchmakingTypeToLabel(MatchmakingType.Match2v2Fastest, useDefault)).toBe(
        '2v2 Fastest',
      )
      expect(matchmakingTypeToLabel(MatchmakingType.Match3v3Bgh, useDefault)).toBe('3v3 BGH')
      expect(matchmakingTypeToLabel(MatchmakingType.Match3v3Hunters, useDefault)).toBe(
        '3v3 Hunters',
      )
      expect(matchmakingTypeToLabel(MatchmakingType.Match3v3Fastest, useDefault)).toBe(
        '3v3 Fastest',
      )
    })

    it('looks up labels by the expected i18n keys (kept extractable for i18next-cli)', () => {
      // A `t` that echoes its key so we assert the exact key each mode resolves to.
      const echoKey = ((key: string) => key) as any
      expect(matchmakingTypeToLabel(MatchmakingType.Match1v1, echoKey)).toBe('matchmaking.type.1v1')
      expect(matchmakingTypeToLabel(MatchmakingType.Match1v1Fastest, echoKey)).toBe(
        'matchmaking.type.1v1fastest',
      )
      expect(matchmakingTypeToLabel(MatchmakingType.Match2v2, echoKey)).toBe('matchmaking.type.2v2')
      expect(matchmakingTypeToLabel(MatchmakingType.Match2v2Bgh, echoKey)).toBe(
        'matchmaking.type.2v2bgh',
      )
      expect(matchmakingTypeToLabel(MatchmakingType.Match2v2Hunters, echoKey)).toBe(
        'matchmaking.type.2v2hunters',
      )
      expect(matchmakingTypeToLabel(MatchmakingType.Match2v2Fastest, echoKey)).toBe(
        'matchmaking.type.2v2fastest',
      )
      expect(matchmakingTypeToLabel(MatchmakingType.Match3v3Bgh, echoKey)).toBe(
        'matchmaking.type.3v3bgh',
      )
      expect(matchmakingTypeToLabel(MatchmakingType.Match3v3Hunters, echoKey)).toBe(
        'matchmaking.type.3v3hunters',
      )
      expect(matchmakingTypeToLabel(MatchmakingType.Match3v3Fastest, echoKey)).toBe(
        'matchmaking.type.3v3fastest',
      )
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
      expect(defaultPreferenceData(MatchmakingType.Match2v2Bgh)).toEqual({})
      expect(defaultPreferenceData(MatchmakingType.Match2v2Hunters)).toEqual({})
      expect(defaultPreferenceData(MatchmakingType.Match2v2Fastest)).toEqual({})
      expect(defaultPreferenceData(MatchmakingType.Match3v3Bgh)).toEqual({})
      expect(defaultPreferenceData(MatchmakingType.Match3v3Hunters)).toEqual({})
      expect(defaultPreferenceData(MatchmakingType.Match3v3Fastest)).toEqual({})
    })
  })

  describe('getDivisionBeforeRatingChange', () => {
    const change = {
      matchmakingType: MatchmakingType.Match1v1,
      points: 900,
      pointsChange: 120,
      lifetimeGames: 20,
    }

    it('places the points from before the change', () => {
      // 900 after the game is Bronze 2, but the 780 going into it was still Bronze 1.
      expect(getDivisionBeforeRatingChange(change, ctx(0))).toBe(MatchmakingDivision.Bronze1)
      expect(getDivisionBeforeRatingChange({ ...change, pointsChange: -20 }, ctx(0))).toBe(
        MatchmakingDivision.Bronze2,
      )
    })

    it('uses the bonus pool it is given', () => {
      expect(getDivisionBeforeRatingChange({ ...change, points: 4600 }, ctx(0))).toBe(
        MatchmakingDivision.Silver2,
      )
      expect(getDivisionBeforeRatingChange({ ...change, points: 4600 }, ctx(2400))).toBe(
        MatchmakingDivision.Silver1,
      )
    })

    it('treats a player still in placements going into the game as unrated', () => {
      expect(getDivisionBeforeRatingChange({ ...change, lifetimeGames: 5 }, ctx(0))).toBe(
        MatchmakingDivision.Unrated,
      )
      expect(getDivisionBeforeRatingChange({ ...change, lifetimeGames: 6 }, ctx(0))).toBe(
        MatchmakingDivision.Bronze1,
      )
    })
  })
})
