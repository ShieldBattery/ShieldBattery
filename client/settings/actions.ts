import { AccountSettings } from '../../common/settings/account-settings'
import { LocalSettings, ScrSettings } from '../../common/settings/local-settings'

export type SettingsActions = UpdateLocalSettings | UpdateScrSettings | UpdateAccountSettings

/**
 * Update the local settings with the new settings.
 */
export interface UpdateLocalSettings {
  type: '@settings/updateLocalSettings'
  payload: Partial<LocalSettings>
}

/**
 * Update the SC:R settings with the new settings.
 */
export interface UpdateScrSettings {
  type: '@settings/updateScrSettings'
  payload: Partial<ScrSettings>
}

/**
 * Replace the account settings with a complete new copy, sourced from the server (an update event,
 * a merge response) or the local cache used before either has arrived.
 */
export interface UpdateAccountSettings {
  type: '@settings/updateAccountSettings'
  payload: AccountSettings
}
