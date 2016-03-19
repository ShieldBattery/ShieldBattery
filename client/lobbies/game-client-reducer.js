import Immutable, { Record } from 'immutable'
import {
  PSI_GAME_LAUNCH,
  PSI_GAME_STATUS,
} from '../actions'

export const GameStatus = new Record({
  state: 'unknown',
  extra: null,
})
export const GameClient = new Record({
  gameId: null,
  status: new GameStatus(),
})

const handlers = {
  [PSI_GAME_LAUNCH](state, action) {
    if (action.error) {
      return new GameClient()
    }

    return new GameClient({ gameId: action.payload })
  },

  [PSI_GAME_STATUS](state, action) {
    return state.set('status', new GameStatus({
      state: action.payload.state,
      extra: action.payload.extra ? Immutable.fromJS(action.payload.extra) : null,
    }))
  },
}

export default function gameClientReducer(state = new GameClient(), action) {
  return handlers.hasOwnProperty(action.type) ? handlers[action.type](state, action) : state
}
