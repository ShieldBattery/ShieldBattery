import { Record } from 'immutable'
import keyedReducer from '../reducers/keyed-reducer'
import {
  LOBBY_UPDATE_STATUS,
} from '../actions'

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
    const { source } = action.payload

    return state.set('gameplayActivity', source)
  }
})
