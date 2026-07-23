import { describe, expect, test } from 'vitest'
import { FfaColorPreset, TeamColorPreset } from './local-settings'
import {
  cloneCustomTeamColors,
  consumeMatchingColor,
  FFA_COLOR_PRESETS,
  resolveFfaColors,
  resolveTeamColors,
  resolveTeamSelfOverride,
  TEAM_COLOR_PRESETS,
} from './team-colors'

describe('common/settings/team-colors', () => {
  // consumeMatchingColor is a hand-reimplementation of the color engine's ally-pool consume
  // (game/src/team_colors.rs: consume the first `colors_eq` match only when `allies.len() > 1`).
  // The settings preview relies on it matching the engine exactly, so these lock the shared
  // invariants down: a drift here would make the preview misrepresent in-game colors.
  describe('consumeMatchingColor', () => {
    test('an undefined color is a no-op (no override in effect)', () => {
      expect(consumeMatchingColor(['#111111', '#222222'], undefined)).toEqual([
        '#111111',
        '#222222',
      ])
    })

    test('an empty pool stays empty', () => {
      expect(consumeMatchingColor([], '#111111')).toEqual([])
    })

    test('a single-entry pool is never consumed, even when it matches', () => {
      // A length-1 pool is a valid "everyone matches" scheme, not a collision to resolve; emptying
      // it would leave nothing for the allies to draw. Mirrors the engine's `len() > 1` guard.
      expect(consumeMatchingColor(['#111111'], '#111111')).toEqual(['#111111'])
    })

    test('removes only the first matching entry when the color repeats', () => {
      expect(consumeMatchingColor(['#111111', '#222222', '#111111'], '#111111')).toEqual([
        '#222222',
        '#111111',
      ])
    })

    test('matches case-insensitively', () => {
      expect(consumeMatchingColor(['#ABCDEF', '#222222'], '#abcdef')).toEqual(['#222222'])
      expect(consumeMatchingColor(['#abcdef', '#222222'], '#ABCDEF')).toEqual(['#222222'])
    })

    test('a color absent from the pool is a no-op', () => {
      expect(consumeMatchingColor(['#111111', '#222222'], '#333333')).toEqual([
        '#111111',
        '#222222',
      ])
    })

    test('returns a fresh array and never mutates the input', () => {
      const pool = ['#111111', '#222222']
      const result = consumeMatchingColor(pool, '#111111')
      expect(result).not.toBe(pool)
      expect(pool).toEqual(['#111111', '#222222'])
      // A no-op path is a copy too, so a caller can freely mutate the result.
      const copy = consumeMatchingColor(pool, undefined)
      expect(copy).not.toBe(pool)
    })
  })

  describe('resolveTeamColors', () => {
    test('resolves a built-in preset to its preset colors', () => {
      expect(
        resolveTeamColors({
          teamColorPreset: TeamColorPreset.CoolVsWarm,
          customTeamColors: { self: '#000000', allies: [], enemies: [] },
        }),
      ).toEqual(TEAM_COLOR_PRESETS[TeamColorPreset.CoolVsWarm])
    })

    test('resolves Custom to the custom colors', () => {
      const customTeamColors = { self: '#111111', allies: ['#222222'], enemies: ['#333333'] }
      expect(
        resolveTeamColors({ teamColorPreset: TeamColorPreset.Custom, customTeamColors }),
      ).toEqual(customTeamColors)
    })

    test('returns a fresh, mutable copy that does not alias the source', () => {
      const resolved = resolveTeamColors({
        teamColorPreset: TeamColorPreset.CoolVsWarm,
        customTeamColors: { self: '#000000', allies: [], enemies: [] },
      })
      resolved.allies.push('#ffffff')
      resolved.self = '#ffffff'
      // The preset constant is unchanged by mutating the resolved copy.
      expect(TEAM_COLOR_PRESETS[TeamColorPreset.CoolVsWarm].allies).not.toContain('#ffffff')
      expect(TEAM_COLOR_PRESETS[TeamColorPreset.CoolVsWarm].self).not.toBe('#ffffff')
    })
  })

  describe('resolveTeamSelfOverride', () => {
    const resolvedColors = { self: '#aaaaaa' }

    test('LegacyDiplomacy always uses the scheme self color, ignoring any stored override', () => {
      expect(
        resolveTeamSelfOverride(
          { teamColorPreset: TeamColorPreset.LegacyDiplomacy, teamSelfColor: '#bbbbbb' },
          resolvedColors,
        ),
      ).toBe('#aaaaaa')
    })

    test('a non-Legacy preset uses the explicit override when set', () => {
      expect(
        resolveTeamSelfOverride(
          { teamColorPreset: TeamColorPreset.CoolVsWarm, teamSelfColor: '#bbbbbb' },
          resolvedColors,
        ),
      ).toBe('#bbbbbb')
    })

    test('a non-Legacy preset with no override is undefined (self draws from the pool)', () => {
      expect(
        resolveTeamSelfOverride(
          { teamColorPreset: TeamColorPreset.CoolVsWarm, teamSelfColor: undefined },
          resolvedColors,
        ),
      ).toBeUndefined()
    })

    test('Custom behaves like the other built-ins: it does not pin its own self color', () => {
      // Custom's self is just the head of its own pool, like a built-in's hero color; it is only
      // pinned when the user sets an explicit teamSelfColor, not merely for being user-authored.
      expect(
        resolveTeamSelfOverride(
          { teamColorPreset: TeamColorPreset.Custom, teamSelfColor: undefined },
          resolvedColors,
        ),
      ).toBeUndefined()
      expect(
        resolveTeamSelfOverride(
          { teamColorPreset: TeamColorPreset.Custom, teamSelfColor: '#bbbbbb' },
          resolvedColors,
        ),
      ).toBe('#bbbbbb')
    })
  })

  describe('resolveFfaColors', () => {
    test('resolves a built-in preset to its preset pool', () => {
      expect(
        resolveFfaColors({ ffaColorPreset: FfaColorPreset.Jewel, customFfaColors: [] }),
      ).toEqual(FFA_COLOR_PRESETS[FfaColorPreset.Jewel])
    })

    test('resolves Custom to the custom pool', () => {
      const customFfaColors = ['#111111', '#222222']
      expect(resolveFfaColors({ ffaColorPreset: FfaColorPreset.Custom, customFfaColors })).toEqual(
        customFfaColors,
      )
    })

    test('returns a fresh copy that does not alias the source', () => {
      const resolved = resolveFfaColors({
        ffaColorPreset: FfaColorPreset.Jewel,
        customFfaColors: [],
      })
      resolved.push('#ffffff')
      expect(FFA_COLOR_PRESETS[FfaColorPreset.Jewel]).not.toContain('#ffffff')
    })
  })

  describe('cloneCustomTeamColors', () => {
    test('copies the values into fresh arrays that do not alias the source', () => {
      const source = { self: '#111111', allies: ['#222222'], enemies: ['#333333'] }
      const clone = cloneCustomTeamColors(source)
      expect(clone).toEqual(source)
      expect(clone.allies).not.toBe(source.allies)
      expect(clone.enemies).not.toBe(source.enemies)

      clone.allies.push('#ffffff')
      expect(source.allies).toEqual(['#222222'])
    })
  })
})
