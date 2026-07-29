import { ReadonlyDeep } from 'type-fest'
import { LobbyState } from '../../common/lobbies'
import { SbLobbyId } from '../../common/lobbies/sb-lobby-id'
import { LOBBIES_GET_STATE, LOBBIES_GET_STATE_BEGIN } from '../actions'
import { immerKeyedReducer } from '../reducers/keyed-reducer'

export interface RetrievedLobbyState {
  state?: LobbyState
  error?: Error
  time?: number
  isRequesting: boolean
}

const DEFAULT_STATE: ReadonlyDeep<Map<SbLobbyId, RetrievedLobbyState>> = new Map()

export default immerKeyedReducer(DEFAULT_STATE, {
  [LOBBIES_GET_STATE_BEGIN as any](
    state: Map<SbLobbyId, RetrievedLobbyState>,
    action: { payload: { lobbyId: SbLobbyId } },
  ) {
    const { lobbyId } = action.payload
    if (state.has(lobbyId)) {
      state.get(lobbyId)!.isRequesting = true
    } else {
      state.set(lobbyId, {
        isRequesting: true,
      })
    }
  },

  [LOBBIES_GET_STATE as any](
    state: Map<SbLobbyId, RetrievedLobbyState>,
    action:
      | {
          meta: { lobbyId: SbLobbyId; requestTime: number }
          payload: { lobbyState: LobbyState }
          error: false
        }
      | {
          meta: { lobbyId: SbLobbyId; requestTime: number }
          payload: Error
          error: true
        },
  ) {
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
