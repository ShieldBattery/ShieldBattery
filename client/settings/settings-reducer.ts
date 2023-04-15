import { Immutable } from 'immer'
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

const DEFAULT_SETTINGS_STATE: Immutable<SettingsState> = {
  open: false,
  subPage: AppSettingsSubPage.Sound,

  local: DEFAULT_LOCAL_SETTINGS,
  scr: DEFAULT_SCR_SETTINGS,
}

export default immerKeyedReducer(DEFAULT_SETTINGS_STATE, {
  ['@settings/openSettings'](state, action) {
    state.open = true
    state.subPage = action.payload.subPage
  },

  ['@settings/closeSettings'](state, action) {
    state.open = false
  },

  ['@settings/changeSettingsSubPage'](state, action) {
    state.subPage = action.payload.subPage
  },

  ['@settings/updateLocalSettings'](state, action) {
    state.local = { ...state.local, ...action.payload }
  },

  ['@settings/updateScrSettings'](state, action) {
    state.scr = { ...state.scr, ...action.payload }
  },
})
