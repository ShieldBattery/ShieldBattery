import { ReadonlyDeep } from 'type-fest'
import { AUDIO_MANAGER_INITIALIZED, NETWORK_SITE_DISCONNECTED } from '../actions'
import { immerKeyedReducer } from '../reducers/keyed-reducer'

export interface LoadingState {
  audio: boolean
  chat: boolean
  clientSubscriptions: boolean
  userSubscriptions: boolean
  whispers: boolean
}

const DEFAULT_LOADING_STATE: ReadonlyDeep<LoadingState> = {
  audio: true,
  chat: true,
  clientSubscriptions: true,
  userSubscriptions: true,
  whispers: true,
}

export default immerKeyedReducer(DEFAULT_LOADING_STATE, {
  [AUDIO_MANAGER_INITIALIZED as any](state: any) {
    state.audio = false
  },

  ['@loading/chatReady'](state) {
    state.chat = false
  },

  ['@loading/subscribedClient'](state) {
    state.clientSubscriptions = false
  },

  ['@loading/subscribedUser'](state) {
    state.userSubscriptions = false
  },

  ['@loading/whispersReady'](state) {
    state.whispers = false
  },

  [NETWORK_SITE_DISCONNECTED as any](state: any) {
    // Reset the loading state of the stuff that gets initialized through sockets
    state.chat = true
    state.clientSubscriptions = true
    state.userSubscriptions = true
    state.whispers = true
  },
})
