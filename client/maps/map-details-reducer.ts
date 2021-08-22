import { Immutable } from 'immer'
import { MapInfoJson } from '../../common/maps'
import { FetchError } from '../network/fetch-action-types'
import { immerKeyedReducer } from '../reducers/keyed-reducer'

// TODO(2Pac): Figure out if this reducer is even needed. I have no idea what was I thinking when I
// initially made it, but now it seems to me that we can just use the maps-reducer instead.

export interface MapDetailsState {
  /** A map that was requested, with all of the details included. */
  map?: MapInfoJson
  /** A flag indicating whether we're currently uploading a local map. */
  isRequesting: boolean
  /** A potential error of our request to upload a local map. */
  lastError?: FetchError
}

const DEFAULT_STATE: Immutable<MapDetailsState> = {
  map: undefined,
  isRequesting: false,
  lastError: undefined,
}

export default immerKeyedReducer(DEFAULT_STATE, {
  ['@maps/getMapDetailsBegin'](state, action) {
    state.isRequesting = true
    state.lastError = undefined
  },

  ['@maps/getMapDetails'](state, action) {
    state.isRequesting = false
    state.lastError = undefined

    if (action.error) {
      state.lastError = action.payload
      return
    }

    state.map = action.payload.map
  },

  ['@maps/updateMap'](state, action) {
    if (action.error) {
      // TODO(2Pac): Show the error to the user somehow?
      return
    }

    state.map = action.payload.map
  },
})
