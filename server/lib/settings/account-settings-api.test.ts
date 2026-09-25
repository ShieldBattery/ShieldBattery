import { describe, expect, test } from 'vitest'
import { MAX_STATUS_MESSAGE_LENGTH, UserAvailability } from '../../../common/users/availability'
import { updateAccountSettingsSchema } from './account-settings-api'

describe('settings/account-settings-api', () => {
  describe('updateAccountSettingsSchema', () => {
    test('accepts a known availability and a trimmed status message', () => {
      const { error, value } = updateAccountSettingsSchema.validate({
        availability: UserAvailability.DoNotDisturb,
        statusMessage: '  back in 10  ',
      })

      expect(error).toBeUndefined()
      expect(value).toEqual({
        availability: UserAvailability.DoNotDisturb,
        statusMessage: 'back in 10',
      })
    })

    test('accepts an empty status message', () => {
      expect(updateAccountSettingsSchema.validate({ statusMessage: '' }).error).toBeUndefined()
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

    test('rejects an over-long status message', () => {
      const statusMessage = 'a'.repeat(MAX_STATUS_MESSAGE_LENGTH + 1)
      expect(updateAccountSettingsSchema.validate({ statusMessage }).error).toBeDefined()
    })

    test('measures the status message after trimming', () => {
      const statusMessage = ` ${'a'.repeat(MAX_STATUS_MESSAGE_LENGTH)} `
      expect(updateAccountSettingsSchema.validate({ statusMessage }).error).toBeUndefined()
    })

    test('rejects a multi-line status message', () => {
      expect(
        updateAccountSettingsSchema.validate({ statusMessage: 'one\ntwo' }).error,
      ).toBeDefined()
    })
  })
})
