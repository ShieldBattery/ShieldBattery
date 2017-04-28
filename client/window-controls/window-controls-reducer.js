import { Record } from 'immutable'
import keyedReducer from '../reducers/keyed-reducer'
import {
  WINDOW_CONTROLS_MAXIMIZED_STATE,
} from '../actions'

export const WindowControlsMode = new Record({
  isMaximized: false,
})

export default keyedReducer(new WindowControlsMode(), {
  [WINDOW_CONTROLS_MAXIMIZED_STATE](state, action) {
    return state.set('isMaximized', action.payload)
  }
})
