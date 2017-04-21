import { Record } from 'immutable'
import keyedReducer from '../reducers/keyed-reducer'
import {
  STARCRAFT_DOWNGRADE_BEGIN,
  STARCRAFT_DOWNGRADE,
  STARCRAFT_DOWNGRADE_PATH_USAGE,
  STARCRAFT_PATH_VALIDITY,
  STARCRAFT_VERSION_VALIDITY,
} from '../actions'

export const StarcraftStatus = new Record({
  pathValid: false,
  versionValid: false,
  usingDowngradePath: false,

  downgradeInProgress: false,
  lastDowngradeAttempt: -1,
  lastDowngradeError: null,
})

export default keyedReducer(new StarcraftStatus(), {
  [STARCRAFT_PATH_VALIDITY](state, action) {
    return state.set('pathValid', action.payload)
  },

  [STARCRAFT_VERSION_VALIDITY](state, action) {
    return state.set('versionValid', action.payload)
  },

  [STARCRAFT_DOWNGRADE_PATH_USAGE](state, action) {
    return state.set('usingDowngradePath', action.payload)
  },

  [STARCRAFT_DOWNGRADE_BEGIN](state, action) {
    return (state
      .set('downgradeInProgress', true)
      .set('lastDowngradeAttempt', action.payload.timestamp)
    )
  },

  [STARCRAFT_DOWNGRADE](state, action) {
    return (state
      .set('downgradeInProgress', false)
      .set('lastDowngradeError', action.error ? action.payload : null)
    )
  },
})
