import { Record } from 'immutable'
import keyedReducer from '../reducers/keyed-reducer'
import {
  LOBBY_UPDATE_STATUS,
} from '../actions'

export const GameplayActivity = new Record({
  isInGameplayActivity: false,
})

export default keyedReducer(new GameplayActivity(), {
  [LOBBY_UPDATE_STATUS](state, action) {
    const { isInLobby } = action.payload

    return state.set('isInGameplayActivity', isInLobby)
  }
})
