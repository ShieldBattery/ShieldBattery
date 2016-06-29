import { Record } from 'immutable'
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

const handlers = {
  [CHAT_LOADING_COMPLETE](state, action) {
    return state.set('chat', false)
  },

  [SUBSCRIPTIONS_LOADING_COMPLETE](state, action) {
    return state.set('lobbies', false)
  },

  [WHISPERS_LOADING_COMPLETE](state, action) {
    return state.set('whispers', false)
  },
}

export default function(state = new LoadingState(), action) {
  return handlers.hasOwnProperty(action.type) ? handlers[action.type](state, action) : state
}
