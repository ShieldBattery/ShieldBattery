import { Record } from 'immutable'
import {
  AUDIO_MANAGER_INITIALIZED,
  CHAT_LOADING_COMPLETE,
  NETWORK_SITE_DISCONNECTED,
  SUBSCRIPTIONS_CLIENT_LOADING_COMPLETE,
  SUBSCRIPTIONS_USER_LOADING_COMPLETE,
  WHISPERS_LOADING_COMPLETE,
} from '../actions'
import keyedReducer from '../reducers/keyed-reducer'

export const LoadingState = new Record({
  audio: true,
  chat: true,
  clientSubscriptions: true,
  userSubscriptions: true,
  whispers: true,
})

export default keyedReducer(new LoadingState(), {
  [AUDIO_MANAGER_INITIALIZED](state, action) {
    return state.set('audio', false)
  },

  [CHAT_LOADING_COMPLETE](state, action) {
    return state.set('chat', false)
  },

  [SUBSCRIPTIONS_CLIENT_LOADING_COMPLETE](state, action) {
    return state.set('clientSubscriptions', false)
  },

  [SUBSCRIPTIONS_USER_LOADING_COMPLETE](state, action) {
    return state.set('userSubscriptions', false)
  },

  [WHISPERS_LOADING_COMPLETE](state, action) {
    return state.set('whispers', false)
  },

  [NETWORK_SITE_DISCONNECTED](state, action) {
    // Reset the loading state of the stuff that gets initialized through sockets
    return state.withMutations(s =>
      s
        .set('chat', true)
        .set('clientSubscriptions', true)
        .set('userSubscriptions', true)
        .set('whispers', true),
    )
  },
})
