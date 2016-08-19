import { Record } from 'immutable'
import keyedReducer from '../reducers/keyed-reducer'
import {
  LOBBY_UPDATE_GAME_STARTED,
  PSI_GAME_STATUS,
} from '../actions'

export const ActiveGame = new Record({
  isActive: false,
})

export default keyedReducer(new ActiveGame(), {
  [LOBBY_UPDATE_GAME_STARTED](state, action) {
    return state.set('isActive', true)
  },

  [PSI_GAME_STATUS](state, action) {
    if (action.payload.state === 'unknown' || action.payload.state === 'finished') {
      return state.set('isActive', false)
    } else {
      return state.set('isActive', true)
    }
  }
})
