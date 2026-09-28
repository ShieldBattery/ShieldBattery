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
  })
})
