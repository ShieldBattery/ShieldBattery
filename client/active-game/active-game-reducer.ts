import { Record } from 'immutable'
import { keyedReducer } from '../reducers/keyed-reducer'
import { ActiveGameStatus } from './actions'

export class ActiveGame extends Record({
  isActive: false,
}) {}

// TODO(tec27): Combine this reducer with game-client-reducer, they are so close to the exact
// same thing
export default keyedReducer(new ActiveGame(), {
  ['@lobbies/updateGameStarted'](state, action) {
    return state.set('isActive', true)
  },

  ['@matchmaking/gameStarted'](state, action) {
    return state.set('isActive', true)
  },

  ['@active-game/status'](state: ActiveGame, action: ActiveGameStatus) {
    const { state: status } = action.payload
    if (status !== 'playing') {
      return new ActiveGame()
    }

    return state
  },
})
