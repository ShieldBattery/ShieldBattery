import { Record } from 'immutable'
import keyedReducer from '../reducers/keyed-reducer'
import {
  AUDIO_MANAGER_INITIALIZED,
  CHAT_LOADING_COMPLETE,
  SUBSCRIPTIONS_LOADING_COMPLETE,
  WHISPERS_LOADING_COMPLETE,
} from '../actions'

export const LoadingState = new Record({
  audio: true,
  chat: true,
  lobbies: true,
  whispers: true,
})

export default keyedReducer(new LoadingState(), {
  [AUDIO_MANAGER_INITIALIZED](state, action) {
    return state.set('audio', false)
  },

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
