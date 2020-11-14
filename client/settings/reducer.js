import { Record } from 'immutable'
import keyedReducer from '../reducers/keyed-reducer'
import { LocalSettings, ScrSettings } from './settings-records'
import {
  LOCAL_SETTINGS_SET_BEGIN,
  LOCAL_SETTINGS_SET,
  LOCAL_SETTINGS_UPDATE,
  SCR_SETTINGS_SET_BEGIN,
  SCR_SETTINGS_SET,
  SCR_SETTINGS_UPDATE,
} from '../actions'

export const Settings = new Record({
  local: new LocalSettings(),
  scr: new ScrSettings(),
  global: null,

  // TODO(2Pac): If there's ever a need for it, separate this object into multiple objects for each
  // setting type.
  lastError: null,
})

export const localSettingsReducer = keyedReducer(new LocalSettings(), {
  [LOCAL_SETTINGS_UPDATE](state, action) {
    if (action.error) {
      // TODO(tec27): deal with the error
    }

    return new LocalSettings(action.payload)
  },
})

export const scrSettingsReducer = keyedReducer(new ScrSettings(), {
  [SCR_SETTINGS_UPDATE](state, action) {
    if (action.error) {
      // TODO(tec27): deal with the error
    }

    return new ScrSettings(action.payload)
  },
})

export const globalSettingsReducer = keyedReducer(null, {})

export default function settingsReducer(state = new Settings(), action) {
  switch (action.type) {
    case LOCAL_SETTINGS_SET_BEGIN:
    case SCR_SETTINGS_SET_BEGIN:
      return state.set('lastError', null)
    case LOCAL_SETTINGS_SET:
    case SCR_SETTINGS_SET:
      if (action.error) {
        return state.set('lastError', action.error)
      }
  }

  return state.withMutations(state => {
    state
      .set('local', localSettingsReducer(state.local, action))
      .set('scr', scrSettingsReducer(state.scr, action))
      .set('global', globalSettingsReducer(state.global, action))
  })
}
