import { Record } from 'immutable'
import keyedReducer from '../reducers/keyed-reducer'
import {
  STARCRAFT_PATH_VALIDITY,
  STARCRAFT_REMASTERED_STATUS,
  STARCRAFT_VERSION_VALIDITY,
} from '../actions'

export const StarcraftStatus = new Record({
  pathValid: false,
  versionValid: false,
  isRemastered: false,
})

export default keyedReducer(new StarcraftStatus(), {
  [STARCRAFT_PATH_VALIDITY](state, action) {
    return state.set('pathValid', action.payload)
  },

  [STARCRAFT_VERSION_VALIDITY](state, action) {
    return state.set('versionValid', action.payload)
  },

  [STARCRAFT_REMASTERED_STATUS](state, action) {
    return state.set('isRemastered', action.payload)
  },
})
