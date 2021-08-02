import { Record } from 'immutable'
import { LOBBY_UPDATE_STATUS, NETWORK_SITE_CONNECTED } from '../actions'
import { keyedReducer } from '../reducers/keyed-reducer'

const BaseGameplayActivity = new Record({
  gameplayActivity: null,
})
export class GameplayActivity extends BaseGameplayActivity {
  get inGameplayActivity() {
    return !!this.gameplayActivity
  }
}

export default keyedReducer(new GameplayActivity(), {
  [LOBBY_UPDATE_STATUS](state, action) {
    const { lobby } = action.payload

    return state.set('gameplayActivity', lobby ? 'lobby' : null)
  },

  ['@matchmaking/status'](state, action) {
    const { matchmaking } = action.payload

    return state.set('gameplayActivity', matchmaking ? 'matchmaking' : null)
  },

  [NETWORK_SITE_CONNECTED](state, action) {
    return new GameplayActivity()
  },
})
