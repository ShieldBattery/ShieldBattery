import { Immutable } from 'immer'
import { FetchError } from '../network/fetch-errors'
import { immerKeyedReducer } from '../reducers/keyed-reducer'

export interface LocalMapsState {
  /** A flag indicating whether we're currently uploading a local map. */
  isUploading: boolean
  /** A potential error of our request to upload a local map. */
  lastError?: FetchError
}

const DEFAULT_STATE: Immutable<LocalMapsState> = {
  isUploading: false,
  lastError: undefined,
}

export default immerKeyedReducer(DEFAULT_STATE, {
  ['@maps/uploadLocalMapBegin'](state, action) {
    state.isUploading = true
    state.lastError = undefined
  },

  ['@maps/uploadLocalMap'](state, action) {
    state.isUploading = false
    state.lastError = undefined

    if (action.error) {
      state.lastError = action.payload
      return
    }
  },
})
