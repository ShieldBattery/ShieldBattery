import { Record } from 'immutable'
import {
  LOCAL_SETTINGS_SET,
  LOCAL_SETTINGS_UPDATE,
} from '../actions'

export const LocalSettings = new Record({
  width: -1,
  height: -1,
  displayMode: 0,
  mouseSensitivity: 0,
  maintainAspectRatio: true,
  renderer: 0,
  starcraftPath: null,
  gameWinX: null,
  gameWinY: null,
})

export const Settings = new Record({
  local: new LocalSettings(),
  global: null,
})

export function localSettingsReducer(state = new LocalSettings(), action) {
  if (action.type === LOCAL_SETTINGS_UPDATE) {
    if (action.error) {
      // TODO(tec27): deal with the error
    } else {
      return new LocalSettings(action.payload)
    }
  } else if (action.type === LOCAL_SETTINGS_SET) {
    // LOCAL_SETTINGS_UPDATE will update the settings if they change. Only handle the errors here
    if (action.error) {
      // TODO(2Pac): deal with the error
    }
  }

  return state
}

export function globalSettingsReducer(state = null, action) {
  return state
}

export default function settingsReducer(state = new Settings(), action) {
  return state.withMutations(state => {
    state.set('local', localSettingsReducer(state.local, action))
      .set('global', globalSettingsReducer(state.global, action))
  })
}
