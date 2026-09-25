import { describe, expect, test } from 'vitest'
import { DEFAULT_ACCOUNT_SETTINGS, fillAccountSettingsDefaults } from './account-settings'

describe('common/settings/account-settings', () => {
  describe('fillAccountSettingsDefaults', () => {
    test('an empty object yields the defaults', () => {
      expect(fillAccountSettingsDefaults({})).toEqual(DEFAULT_ACCOUNT_SETTINGS)
      expect(fillAccountSettingsDefaults({}).chatDisplayMode).toBe('classic')
    })

    test('non-object input yields the defaults', () => {
      expect(fillAccountSettingsDefaults(undefined)).toEqual(DEFAULT_ACCOUNT_SETTINGS)
      expect(fillAccountSettingsDefaults(null)).toEqual(DEFAULT_ACCOUNT_SETTINGS)
    })

    test('a known chat display mode is kept', () => {
      expect(fillAccountSettingsDefaults({ chatDisplayMode: 'cozy' }).chatDisplayMode).toBe('cozy')
    })

    test('an unknown chat display mode falls back to the default', () => {
      expect(fillAccountSettingsDefaults({ chatDisplayMode: 'compact' }).chatDisplayMode).toBe(
        'classic',
      )
    })

    test('a wrong-typed chat display mode falls back to the default', () => {
      expect(fillAccountSettingsDefaults({ chatDisplayMode: 7 }).chatDisplayMode).toBe('classic')
    })
  })
})
