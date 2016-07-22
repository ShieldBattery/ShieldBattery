import { Record } from 'immutable'
import keyedReducer from '../reducers/keyed-reducer'
import {
  CHAT_LOADING_COMPLETE,
  SUBSCRIPTIONS_LOADING_COMPLETE,
  WHISPERS_LOADING_COMPLETE,
} from '../actions'

export const LoadingState = new Record({
  chat: true,
  lobbies: true,
  whispers: true,
})

export default keyedReducer(new LoadingState(), {
  [CHAT_LOADING_COMPLETE](state, action) {
    return state.set('chat', false)
  },

  [SUBSCRIPTIONS_LOADING_COMPLETE](state, action) {
    return state.set('lobbies', false)
  },

  [WHISPERS_LOADING_COMPLETE](state, action) {
    return state.set('whispers', false)
  },
})
