import { Record } from 'immutable'
import keyedReducer from '../reducers/keyed-reducer'
import { LOCAL_SETTINGS_SET_BEGIN, LOCAL_SETTINGS_SET, LOCAL_SETTINGS_UPDATE } from '../actions'

export const LocalSettings = new Record({
  width: -1,
  height: -1,
  displayMode: 0,
  mouseSensitivity: 0,
  maintainAspectRatio: true,
  starcraftPath: null,
  gameWinX: null,
  gameWinY: null,

  lastError: null,
})

export const Settings = new Record({
  local: new LocalSettings(),
  global: null,
})

export const localSettingsReducer = keyedReducer(new LocalSettings(), {
  [LOCAL_SETTINGS_SET_BEGIN](state, action) {
    return state.set('lastError', null)
  },

  [LOCAL_SETTINGS_SET](state, action) {
    // LOCAL_SETTINGS_UPDATE will update the settings if they change. Only handle the errors here
    if (action.error) {
      return state.set('lastError', action.error)
    }

    return state
  },

  [LOCAL_SETTINGS_UPDATE](state, action) {
    if (action.error) {
      // TODO(tec27): deal with the error
    }

    return new LocalSettings(action.payload)
  },
})

export const globalSettingsReducer = keyedReducer(null, {})

export default function settingsReducer(state = new Settings(), action) {
  return state.withMutations(state => {
    state
      .set('local', localSettingsReducer(state.local, action))
      .set('global', globalSettingsReducer(state.global, action))
  })
}
