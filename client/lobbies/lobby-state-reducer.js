import { Map, Record } from 'immutable'
import {
  LOBBIES_GET_STATE_BEGIN,
  LOBBIES_GET_STATE,
} from '../actions'

export const LobbyState = new Record({
  state: null,
  error: null,
  time: -1,
  isRequesting: false,
})

const handlers = {
  [LOBBIES_GET_STATE_BEGIN](state, action) {
    const { lobbyName } = action.payload
    if (state.has(lobbyName)) {
      return state.setIn([ lobbyName, 'isRequesting' ], true)
    } else {
      return state.set(lobbyName, new LobbyState({
        isRequesting: true,
      }))
    }
  },

  [LOBBIES_GET_STATE](state, action) {
    return state.set(action.meta.lobbyName, new LobbyState({
      time: action.meta.requestTime,
      state: action.error ? null : action.payload.lobbyState,
      error: action.error ? action.payload : null,
      isRequesting: false,
    }))
  },
}

export default function lobbyReducer(state = new Map(), action) {
  return handlers.hasOwnProperty(action.type) ? handlers[action.type](state, action) : state
}
