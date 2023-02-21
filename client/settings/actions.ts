import { LocalSettings, ScrSettings } from '../../common/settings/local-settings'
import { SettingsSubPage } from './settings-sub-page'

export type SettingsActions =
  | ChangeSettingsSubPage
  | CloseSettings
  | OpenSettings
  | UpdateLocalSettings
  | UpdateScrSettings

/**
 * Open the settings page, and optionally a specific sub-page within that.
 */
export interface OpenSettings {
  type: '@settings/openSettings'
  payload: {
    subPage: SettingsSubPage
  }
}

/**
 * Close the settings page.
 */
export interface CloseSettings {
  type: '@settings/closeSettings'
}

/**
 * Change the settings sub-page.
 */
export interface ChangeSettingsSubPage {
  type: '@settings/changeSettingsSubPage'
  payload: {
    subPage: SettingsSubPage
  }
}

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
