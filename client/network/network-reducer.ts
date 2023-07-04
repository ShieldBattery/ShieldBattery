import { ReadonlyDeep } from 'type-fest'
import { immerKeyedReducer } from '../reducers/keyed-reducer'

export interface NetworkStatus {
  isConnected: boolean
}

const DEFAULT_STATE: ReadonlyDeep<NetworkStatus> = {
  isConnected: false,
}

export default immerKeyedReducer(DEFAULT_STATE, {
  ['@network/connect'](state, _action) {
    state.isConnected = true
  },

  ['@network/disconnect'](state, _action) {
    state.isConnected = false
  },
})
