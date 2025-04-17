import { LocalSettings, ScrSettings } from '../../common/settings/local-settings'

export type SettingsActions = UpdateLocalSettings | UpdateScrSettings

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
