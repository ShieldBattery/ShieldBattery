import { describe, expect, test } from 'vitest'
import { UserAvailability } from '../../../common/users/availability'
import { updateAccountSettingsSchema } from './account-settings-api'

describe('settings/account-settings-api', () => {
  describe('updateAccountSettingsSchema', () => {
    test('accepts a known availability', () => {
      const { error, value } = updateAccountSettingsSchema.validate({
        availability: UserAvailability.DoNotDisturb,
      })

      expect(error).toBeUndefined()
      expect(value).toEqual({ availability: UserAvailability.DoNotDisturb })
    })

    test('accepts the alert toggles', () => {
      const { error, value } = updateAccountSettingsSchema.validate({
        playMessageSounds: false,
        flashTaskbar: false,
      })

      expect(error).toBeUndefined()
      expect(value).toEqual({ playMessageSounds: false, flashTaskbar: false })
    })

    test('rejects a non-boolean alert toggle', () => {
      expect(
        updateAccountSettingsSchema.validate({ flashTaskbar: 'sometimes' }).error,
      ).toBeDefined()
    })

    test('rejects a removed status message', () => {
      expect(
        updateAccountSettingsSchema.validate({ statusMessage: 'back in 10' }).error,
      ).toBeDefined()
    })

    test('rejects an unknown availability', () => {
      expect(
        updateAccountSettingsSchema.validate({ availability: 'invisible' }).error,
      ).toBeDefined()
    })

    test('accepts a known chat display mode', () => {
      expect(
        updateAccountSettingsSchema.validate({ chatDisplayMode: 'cozy' }).error,
      ).toBeUndefined()
      expect(
        updateAccountSettingsSchema.validate({ chatDisplayMode: 'classic' }).error,
      ).toBeUndefined()
    })

    test('rejects an unknown chat display mode', () => {
      expect(
        updateAccountSettingsSchema.validate({ chatDisplayMode: 'compact' }).error,
      ).toBeDefined()
    })

    test('accepts a replay name template, including an empty one', () => {
      expect(
        updateAccountSettingsSchema.validate({ replayNameTemplate: '{date} {matchup}' }).error,
      ).toBeUndefined()
      expect(updateAccountSettingsSchema.validate({ replayNameTemplate: '' }).error).toBeUndefined()
    })

    test('rejects an overlong or non-string replay name template', () => {
      expect(
        updateAccountSettingsSchema.validate({ replayNameTemplate: 'x'.repeat(201) }).error,
      ).toBeDefined()
      expect(updateAccountSettingsSchema.validate({ replayNameTemplate: 5 }).error).toBeDefined()
    })
  })
})
