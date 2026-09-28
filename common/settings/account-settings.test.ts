import { expect, test } from 'vitest'
import { ALL_USER_AVAILABILITIES } from '../users/availability'
import { DEFAULT_ACCOUNT_SETTINGS, fillAccountSettingsDefaults } from './account-settings'

test.each(ALL_USER_AVAILABILITIES)(
  'drops retired status text from stored settings while preserving %s',
  availability => {
    expect(
      fillAccountSettingsDefaults({
        availability,
        statusMessage: 'back soon',
        quietWhispersWhileInGame: false,
      }),
    ).toEqual({
      ...DEFAULT_ACCOUNT_SETTINGS,
      availability,
      quietWhispersWhileInGame: false,
    })
  },
)
