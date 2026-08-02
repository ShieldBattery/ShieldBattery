import { ReadonlyDeep } from 'type-fest'
import { LobbyState } from '../../common/lobbies'
import { SbLobbyId } from '../../common/lobbies/sb-lobby-id'
import { immerKeyedReducer } from '../reducers/keyed-reducer'

export interface RetrievedLobbyState {
  state?: LobbyState
  error?: Error
  time?: number
  isRequesting: boolean
}

const DEFAULT_STATE: ReadonlyDeep<Map<SbLobbyId, RetrievedLobbyState>> = new Map()

export default immerKeyedReducer(DEFAULT_STATE, {
  ['@lobbies/getLobbyStateBegin'](state, action) {
    const { lobbyId } = action.payload
    if (state.has(lobbyId)) {
      state.get(lobbyId)!.isRequesting = true
    } else {
      state.set(lobbyId, {
        isRequesting: true,
      })
    }
  },

  ['@lobbies/getLobbyState'](state, action) {
    return state.set(action.meta.lobbyId, {
      time: action.meta.requestTime,
      state: action.error ? undefined : action.payload.lobbyState,
      error: action.error ? action.payload : undefined,
      isRequesting: false,
    })
  },

  ['@network/connect'](state, action) {
    return DEFAULT_STATE
  },
})
