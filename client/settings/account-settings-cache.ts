import {
  AccountSettings,
  fillAccountSettingsDefaults,
} from '../../common/settings/account-settings'
import { SbUserId } from '../../common/users/sb-user-id'
import { getUserLocalStorageValue, setUserLocalStorageValue } from '../react/state-hooks'

/**
 * A per-account cache of the last account settings the server delivered, kept so a session that
 * can't reach the server starts from those values instead of the defaults. It is written only from
 * server-delivered values (subscription events and update responses), never from optimistic local
 * state, so it never holds a value the server hasn't confirmed.
 */
const ACCOUNT_SETTINGS_KEY = 'accountSettings'

/** Returns the cached account settings for the given user, or `undefined` if none are cached. */
export function readCachedAccountSettings(userId: SbUserId): AccountSettings | undefined {
  const value = getUserLocalStorageValue<unknown>(userId, ACCOUNT_SETTINGS_KEY)
  return value !== undefined ? fillAccountSettingsDefaults(value) : undefined
}

/** Caches the given (server-confirmed) account settings for the given user. */
export function writeCachedAccountSettings(userId: SbUserId, settings: AccountSettings): void {
  setUserLocalStorageValue(userId, ACCOUNT_SETTINGS_KEY, settings)
}
