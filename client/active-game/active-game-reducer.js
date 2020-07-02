import { Record } from 'immutable'
import keyedReducer from '../reducers/keyed-reducer'
import { ACTIVE_GAME_STATUS, LOBBY_UPDATE_GAME_STARTED } from '../actions'

export const ActiveGame = new Record({
  isActive: false,
})

export default keyedReducer(new ActiveGame(), {
  [LOBBY_UPDATE_GAME_STARTED](state, action) {
    return state.set('isActive', true)
  },

  [ACTIVE_GAME_STATUS](state, action) {
    const { state: status } = action.payload
    if (status === 'playing') {
      return state.set('isActive', true)
    } else {
      return state.set('isActive', false)
    }
  },
})
