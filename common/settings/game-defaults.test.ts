import { describe, expect, test } from 'vitest'
import { DEFAULT_LOCAL_SETTINGS } from './default-settings'
import {
  GAME_DEFAULTS_PRESET_KEYS,
  GAME_DEFAULTS_PRESET_VALUES,
  getGameDefaultsMismatches,
} from './game-defaults'
import { GameDefaultsPreset } from './local-settings'

describe('common/settings/game-defaults', () => {
  describe('GAME_DEFAULTS_PRESET_VALUES', () => {
    test('Recommended matches DEFAULT_LOCAL_SETTINGS for every covered key', () => {
      for (const key of GAME_DEFAULTS_PRESET_KEYS) {
        expect(GAME_DEFAULTS_PRESET_VALUES[GameDefaultsPreset.Recommended][key]).toEqual(
          DEFAULT_LOCAL_SETTINGS[key],
        )
      }
    })

    test('both presets define every covered key', () => {
      for (const preset of [GameDefaultsPreset.Recommended, GameDefaultsPreset.Legacy]) {
        for (const key of GAME_DEFAULTS_PRESET_KEYS) {
          expect(GAME_DEFAULTS_PRESET_VALUES[preset][key]).not.toBeUndefined()
        }
      }
    })

    test('the two presets differ on every covered key', () => {
      for (const key of GAME_DEFAULTS_PRESET_KEYS) {
        expect(GAME_DEFAULTS_PRESET_VALUES[GameDefaultsPreset.Recommended][key]).not.toEqual(
          GAME_DEFAULTS_PRESET_VALUES[GameDefaultsPreset.Legacy][key],
        )
      }
    })
  })

  describe('getGameDefaultsMismatches', () => {
    test('settings equal to a preset have no mismatches', () => {
      expect(
        getGameDefaultsMismatches(
          GAME_DEFAULTS_PRESET_VALUES[GameDefaultsPreset.Recommended],
          GameDefaultsPreset.Recommended,
        ),
      ).toEqual([])
    })

    test('settings equal to the other preset mismatch on every key', () => {
      expect(
        getGameDefaultsMismatches(
          GAME_DEFAULTS_PRESET_VALUES[GameDefaultsPreset.Legacy],
          GameDefaultsPreset.Recommended,
        ),
      ).toEqual(GAME_DEFAULTS_PRESET_KEYS)
    })

    test('a partially-changed settings object mismatches only on the changed keys, in key order', () => {
      const settings = {
        ...GAME_DEFAULTS_PRESET_VALUES[GameDefaultsPreset.Recommended],
        teamColorPreset: GAME_DEFAULTS_PRESET_VALUES[GameDefaultsPreset.Legacy].teamColorPreset,
        grabPanSensitivityOn:
          GAME_DEFAULTS_PRESET_VALUES[GameDefaultsPreset.Legacy].grabPanSensitivityOn,
      }

      expect(getGameDefaultsMismatches(settings, GameDefaultsPreset.Recommended)).toEqual([
        'teamColorPreset',
        'grabPanSensitivityOn',
      ])
    })
  })
})
