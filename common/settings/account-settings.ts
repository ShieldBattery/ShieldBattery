import { ReadonlyDeep } from 'type-fest'

/**
 * Settings that are a property of the account rather than the machine: stored on the server,
 * delivered to every session on connect and pushed live to all of them whenever one changes a
 * value. Anything tied to a particular install (paths, audio devices, window geometry, launch
 * options) belongs in `LocalSettings` instead and never syncs.
 *
 * Every key must have a default in `DEFAULT_ACCOUNT_SETTINGS`: the server stores only the keys a
 * user has changed and merges them over the defaults on every read, which is what lets a new key
 * apply to existing accounts without a migration.
 */
export interface AccountSettings {
  /**
   * While this client is in a game, channel messages (mentions included) play no alert sound and
   * don't ask the main process for attention (transient tray icon / taskbar flash); unread and
   * mention marks still record so the true state shows after the game. Whispers are unaffected.
   */
  quietWhileInGame: boolean
}

export const DEFAULT_ACCOUNT_SETTINGS: ReadonlyDeep<AccountSettings> = {
  quietWhileInGame: true,
}

export const ALL_ACCOUNT_SETTINGS_KEYS: ReadonlyArray<keyof AccountSettings> = Object.keys(
  DEFAULT_ACCOUNT_SETTINGS,
) as Array<keyof AccountSettings>

/**
 * Builds a complete `AccountSettings` from a possibly partial, possibly untrusted stored copy (a DB
 * row or a local cache written by an older version). Only known keys whose value has the same type
 * as the default are kept; everything else falls back to the default.
 */
export function fillAccountSettingsDefaults(stored: unknown): AccountSettings {
  const result: AccountSettings = { ...DEFAULT_ACCOUNT_SETTINGS }
  if (typeof stored !== 'object' || stored === null) {
    return result
  }

  const partial = stored as Record<string, unknown>
  for (const key of ALL_ACCOUNT_SETTINGS_KEYS) {
    const value = partial[key]
    if (typeof value === typeof DEFAULT_ACCOUNT_SETTINGS[key]) {
      // Cast needed because TS can't tell that `value` has the type of `result[key]`
      // after the runtime check above.
      ;(result[key] as unknown) = value
    }
  }

  return result
}

/** Body of a request to change account settings. Only the keys present are changed. */
export type UpdateAccountSettingsRequest = Partial<AccountSettings>

export interface AccountSettingsResponse {
  settings: AccountSettings
}

/**
 * Sent on `/account-settings/:userId` with the user's complete settings, both as the initial data
 * when a session subscribes and whenever any session changes a setting.
 */
export interface AccountSettingsUpdateEvent {
  action: 'update'
  settings: AccountSettings
}

export type AccountSettingsEvent = AccountSettingsUpdateEvent
