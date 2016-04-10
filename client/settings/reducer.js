import { Record } from 'immutable'
import {
  LOCAL_SETTINGS_SET,
  LOCAL_SETTINGS_UPDATE,
} from '../actions'

// TODO(tec27): are these the right defaults?
export const LocalSettings = new Record({
  bwPort: 6112,
  width: -1,
  height: -1,
  displayMode: 0,
  mouseSensitivity: 1,
  maintainAspectRatio: true,
  renderer: 0,
  starcraftPath: null,
})

export const Settings = new Record({
  local: new LocalSettings(),
  global: null,
})

export function localSettingsReducer(state = new LocalSettings(), action) {
  if (action.type === LOCAL_SETTINGS_UPDATE) {
    return new LocalSettings(action.payload)
  } else if (action.type === LOCAL_SETTINGS_SET) {
    // LOCAL_SETTINGS_UPDATE will update the settings if the settings file changes. Only handle the
    // errors here
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
