import { ReadonlyDeep } from 'type-fest'
import { LobbyState } from '../../common/lobbies'
import { LOBBIES_GET_STATE, LOBBIES_GET_STATE_BEGIN } from '../actions'
import { immerKeyedReducer } from '../reducers/keyed-reducer'

export interface RetrievedLobbyState {
  state?: LobbyState
  error?: Error
  time?: number
  isRequesting: boolean
}

const DEFAULT_STATE: ReadonlyDeep<Map<string, RetrievedLobbyState>> = new Map()

export default immerKeyedReducer(DEFAULT_STATE, {
  [LOBBIES_GET_STATE_BEGIN as any](
    state: Map<string, RetrievedLobbyState>,
    action: { payload: { lobbyName: string } },
  ) {
    const { lobbyName } = action.payload
    if (state.has(lobbyName)) {
      state.get(lobbyName)!.isRequesting = true
    } else {
      state.set(lobbyName, {
        isRequesting: true,
      })
    }
  },

  [LOBBIES_GET_STATE as any](
    state: Map<string, RetrievedLobbyState>,
    action:
      | {
          meta: { lobbyName: string; requestTime: number }
          payload: { lobbyState: LobbyState }
          error: false
        }
      | {
          meta: { lobbyName: string; requestTime: number }
          payload: Error
          error: true
        },
  ) {
    return state.set(action.meta.lobbyName, {
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
