import { afterEach, expect, test } from 'vitest'
import { DEFAULT_ACCOUNT_SETTINGS } from '../../common/settings/account-settings'
import { UserAvailability } from '../../common/users/availability'
import { makeSbUserId } from '../../common/users/sb-user-id'
import { getUserLocalStorageValue, setUserLocalStorageValue } from '../react/state-hooks'
import { readCachedAccountSettings } from './account-settings-cache'

const USER = makeSbUserId(123)

afterEach(() => localStorage.clear())

test('removes retired status text from the stored cache without changing availability', () => {
  setUserLocalStorageValue(USER, 'accountSettings', {
    ...DEFAULT_ACCOUNT_SETTINGS,
    availability: UserAvailability.DoNotDisturb,
    statusMessage: 'back soon',
    quietWhispersWhileInGame: false,
  })

  const expected = {
    ...DEFAULT_ACCOUNT_SETTINGS,
    availability: UserAvailability.DoNotDisturb,
    quietWhispersWhileInGame: false,
  }
  expect(readCachedAccountSettings(USER)).toEqual(expected)
  expect(getUserLocalStorageValue(USER, 'accountSettings')).toEqual(expected)
})

test('leaves a missing cache unset', () => {
  expect(readCachedAccountSettings(USER)).toBeUndefined()
  expect(getUserLocalStorageValue(USER, 'accountSettings')).toBeUndefined()
})
