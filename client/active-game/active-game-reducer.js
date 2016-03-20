import { Record } from 'immutable'
import {
  LOBBY_UPDATE_GAME_STARTED,
  PSI_GAME_STATUS,
} from '../actions'

export const ActiveGame = new Record({
  isActive: false,
})

const handlers = {
  [LOBBY_UPDATE_GAME_STARTED](state, action) {
    return state.set('isActive', true)
  },

  [PSI_GAME_STATUS](state, action) {
    if (action.payload.state === 'unknown' || action.payload.state === 'finished') {
      return state.set('isActive', false)
    }

    return state
  }
}

export default function activeGameReducer(state = new ActiveGame(), action) {
  return handlers.hasOwnProperty(action.type) ? handlers[action.type](state, action) : state
}
