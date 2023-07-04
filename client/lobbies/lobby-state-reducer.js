import { Map, Record } from 'immutable'
import { LOBBIES_GET_STATE, LOBBIES_GET_STATE_BEGIN } from '../actions'
import { keyedReducer } from '../reducers/keyed-reducer'

export const LobbyState = Record({
  state: null,
  error: null,
  time: -1,
  isRequesting: false,
})

export default keyedReducer(new Map(), {
  [LOBBIES_GET_STATE_BEGIN](state, action) {
    const { lobbyName } = action.payload
    if (state.has(lobbyName)) {
      return state.setIn([lobbyName, 'isRequesting'], true)
    } else {
      return state.set(
        lobbyName,
        new LobbyState({
          isRequesting: true,
        }),
      )
    }
  },

  [LOBBIES_GET_STATE](state, action) {
    return state.set(
      action.meta.lobbyName,
      new LobbyState({
        time: action.meta.requestTime,
        state: action.error ? null : action.payload.lobbyState,
        error: action.error ? action.payload : null,
        isRequesting: false,
      }),
    )
  },

  ['@network/connect'](state, action) {
    return new Map()
  },
})
