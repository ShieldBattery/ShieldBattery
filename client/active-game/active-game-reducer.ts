import { immerKeyedReducer } from '../reducers/keyed-reducer'

export interface ActiveGameState {
  isActive: boolean
}

const DEFAULT_STATE: ActiveGameState = {
  isActive: false,
}

// TODO(tec27): Combine this reducer with game-client-reducer, they are so close to the exact
// same thing
export default immerKeyedReducer(DEFAULT_STATE, {
  ['@lobbies/updateGameStarted'](state) {
    state.isActive = true
  },

  ['@matchmaking/gameStarted'](state) {
    state.isActive = true
  },

  ['@active-game/status'](state, action) {
    if (action.payload.state !== 'playing') {
      state.isActive = false
    }
  },
})
