import Immutable, { Record } from 'immutable'
import keyedReducer from '../reducers/keyed-reducer'
import { ACTIVE_GAME_LAUNCH, ACTIVE_GAME_STATUS } from '../actions'

export const GameStatus = new Record({
  state: 'unknown',
  extra: null,
})
export const GameClient = new Record({
  gameId: null,
  status: new GameStatus(),
})

export default keyedReducer(new GameClient(), {
  [ACTIVE_GAME_LAUNCH](state, action) {
    if (action.error) {
      return new GameClient()
    }

    return state
  },

  [ACTIVE_GAME_STATUS](state, action) {
    return new GameClient({
      gameId: action.payload.id,
      status: new GameStatus({
        state: action.payload.state,
        extra: action.payload.extra ? Immutable.fromJS(action.payload.extra) : null,
      }),
    })
  },
})
