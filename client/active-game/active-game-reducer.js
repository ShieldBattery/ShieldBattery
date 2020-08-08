import { Record } from 'immutable'
import keyedReducer from '../reducers/keyed-reducer'
import {
  ACTIVE_GAME_STATUS,
  LOBBY_UPDATE_GAME_STARTED,
  MATCHMAKING_UPDATE_GAME_STARTED,
} from '../actions'

export const GameInfo = new Record({
  type: null,
  extra: null,
})
export const ActiveGame = new Record({
  isActive: false,
  info: new GameInfo(),
})

export default keyedReducer(new ActiveGame(), {
  [LOBBY_UPDATE_GAME_STARTED](state, action) {
    return state
      .set('isActive', true)
      .set('info', new GameInfo({ type: 'lobby', extra: action.payload }))
  },

  [MATCHMAKING_UPDATE_GAME_STARTED](state, action) {
    return state
      .set('isActive', true)
      .set('info', new GameInfo({ type: 'matchmaking', extra: action.payload }))
  },

  [ACTIVE_GAME_STATUS](state, action) {
    const { state: status } = action.payload
    if (status !== 'playing') {
      return new ActiveGame()
    }

    return state
  },
})
