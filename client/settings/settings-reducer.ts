import { ReadonlyDeep } from 'type-fest'
import {
  LocalSettings,
  ScrSettings,
  ShieldBatteryAppSettings,
} from '../../common/settings/local-settings'
import { immerKeyedReducer } from '../reducers/keyed-reducer'
import { DEFAULT_LOCAL_SETTINGS, DEFAULT_SCR_SETTINGS } from './default-settings'
import { AppSettingsSubPage, SettingsSubPage } from './settings-sub-page'

export interface SettingsState {
  open: boolean
  subPage: SettingsSubPage

  local: Omit<LocalSettings, keyof ShieldBatteryAppSettings>
  scr: Omit<ScrSettings, 'version'>
}

const DEFAULT_SETTINGS_STATE: ReadonlyDeep<SettingsState> = {
  open: false,
  // TODO(2Pac): Change this default value to user account settings page once we move that to the
  // new settings.
  subPage: AppSettingsSubPage.Sound,

  local: DEFAULT_LOCAL_SETTINGS,
  scr: DEFAULT_SCR_SETTINGS,
}

export default immerKeyedReducer(DEFAULT_SETTINGS_STATE, {
  ['@settings/openSettings'](state, action) {
    const { subPage } = action.payload

    state.open = true

    if (subPage) {
      state.subPage = subPage
    }
  },

  ['@settings/closeSettings'](state, action) {
    state.open = false
  },

  ['@settings/changeSettingsSubPage'](state, action) {
    state.subPage = action.payload.subPage
  },

  ['@settings/updateLocalSettings'](state, action) {
    let key: keyof typeof action.payload
    for (key in action.payload) {
      // NOTE(2Pac): Need these casts here because TS compiler can't verify that the
      // `state.local[key]` has the same type as `action.payload[key]`.
      const k = key as keyof Omit<LocalSettings, keyof ShieldBatteryAppSettings>
      ;(state.local[k] as any) = action.payload[key]
    }
  },

  ['@settings/updateScrSettings'](state, action) {
    let key: keyof typeof action.payload
    for (key in action.payload) {
      // NOTE(2Pac): Need these casts here because TS compiler can't verify that the
      // `state.scr[key]` has the same type as `action.payload[key]`.
      const k = key as keyof Omit<ScrSettings, 'version'>
      ;(state.scr[k] as any) = action.payload[key]
    }
  },
})
