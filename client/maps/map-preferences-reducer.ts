import { Immutable } from 'immer'
import { MapPreferences, MapSortType, MapVisibility, NumPlayers, Tileset } from '../../common/maps'
import { FetchError } from '../network/fetch-action-types'
import { immerKeyedReducer } from '../reducers/keyed-reducer'

export interface MapPreferencesState {
  /** The last saved visibility in the maps browser. Can be either official, private, or public.  */
  visibility: MapVisibility
  /** The last saved thumbnail size in the maps browser. */
  thumbnailSize: number
  /** The last saved map sorting option in the maps browser. */
  sortOption: MapSortType
  /** The last saved number of players that was used to filter maps. */
  numPlayersFilter: Set<NumPlayers>
  /** The last saved tileset(s) that was used to filter maps. */
  tilesetFilter: Set<Tileset>
  /** A flag indicating whether we're currently requesting map preferences. */
  isRequesting: boolean
  // NOTE(2Pac): We don't actually display this anywhere since it's not that useful to the user
  /** A potential error of our request to get map preferences. */
  lastError?: FetchError
}

const DEFAULT_STATE: Immutable<MapPreferencesState> = {
  visibility: MapVisibility.Private,
  thumbnailSize: 0,
  sortOption: MapSortType.Name,
  numPlayersFilter: new Set(),
  tilesetFilter: new Set(),
  isRequesting: false,
  lastError: undefined,
}

function updatePreferences(state: MapPreferencesState, preferences: MapPreferences) {
  state.visibility = preferences.visibility
  state.thumbnailSize = preferences.thumbnailSize
  state.sortOption = preferences.sortOption
  state.numPlayersFilter = new Set(preferences.numPlayersFilter)
  state.tilesetFilter = new Set(preferences.tilesetFilter)
  state.isRequesting = false
  state.lastError = undefined
}

export default immerKeyedReducer(DEFAULT_STATE, {
  ['@maps/getMapPreferencesBegin'](state, action) {
    state.isRequesting = true
  },

  ['@maps/getMapPreferences'](state, action) {
    state.isRequesting = false

    if (action.error) {
      state.lastError = action.payload
      return
    }

    updatePreferences(state, action.payload)
  },

  ['@maps/updateMapPreferences'](state, action) {
    state.isRequesting = false

    if (action.error) {
      state.lastError = action.payload
      return
    }

    updatePreferences(state, action.payload)
  },
})
