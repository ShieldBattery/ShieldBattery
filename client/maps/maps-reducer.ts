import { Immutable } from 'immer'
import { MapInfoJson } from '../../common/maps'
import { FetchError } from '../network/fetch-errors'
import { immerKeyedReducer } from '../reducers/keyed-reducer'

/** @deprecated Do not add new things here, use maps2-reducer */
export interface MapsState {
  /**
   * A map of map ID -> information about the map.
   * @deprecated
   */
  byId: Map<string, MapInfoJson>
  /**
   * A map of the favorited map ID -> information about the favorited map.
   * @deprecated
   */
  favoritedById: Map<string, MapInfoJson>
  /**
   * Total number of maps currently saved in a store.
   * @deprecated
   */
  total: number
  /**
   * A flag indicating whether we're currently requesting maps.
   * @deprecated
   */
  isRequesting: boolean
  /**
   * A set of map IDs that the user is currently (un)favoriting.
   * @deprecated
   */
  favoriteStatusRequests: Set<string>
  /**
   * A potential error of our request to get maps.
   * @deprecated
   */
  lastError?: FetchError
}

const DEFAULT_STATE: Immutable<MapsState> = {
  byId: new Map(),
  favoritedById: new Map(),
  total: -1,
  isRequesting: false,
  favoriteStatusRequests: new Set(),
  lastError: undefined,
}

// TODO(tec27): Delete this reducer. This is all legacy code that doesn't work how things should
// with normalized data. Move functionality/dependencies to maps2-reducer as it can be cleaned up
// and then delete this reducer.
export default immerKeyedReducer(DEFAULT_STATE, {
  ['@maps/getMapsBegin'](state, action) {
    state.isRequesting = true
  },

  ['@maps/getMaps'](state, action) {
    state.isRequesting = false
    state.lastError = undefined

    if (action.error) {
      state.lastError = action.payload
      return
    }

    const { maps, total, favoritedMaps } = action.payload

    for (const map of maps) {
      state.byId.set(map.id, map)
    }
    for (const map of favoritedMaps) {
      state.favoritedById.set(map.id, map)
    }

    state.total = total
  },

  ['@maps/toggleFavoriteBegin'](state, action) {
    state.favoriteStatusRequests.add(action.payload.map.id)
  },

  ['@maps/toggleFavorite'](state, action) {
    state.favoriteStatusRequests.delete(action.meta.map.id)

    if (action.error) {
      // TODO(2Pac): Notify the user somehow that this failed?
      return
    }

    // TODO(2Pac): This is pretty bad way to do things. Need to change the purpose of the maps saved
    // in the maps reducer's `byId` property from "these are the maps displayed in the maps browser"
    // to "these are the maps that have been loaded in the app, regardless of where they are used".
    // This would remove the need to have a separate map of favorited maps, so we wouldn't need to
    // try to guess where the map might be saved. There's also a separate issue submitted to rework
    // how the favoriting maps works in general.
    const map = state.byId.get(action.meta.map.id) || state.favoritedById.get(action.meta.map.id)
    if (!map) {
      return
    }

    map.isFavorited = !map.isFavorited

    if (map.isFavorited) {
      state.favoritedById.set(map.id, map)
    } else {
      state.favoritedById.delete(map.id)
    }
  },

  ['@maps/updateMap'](state, action) {
    if (action.error) {
      // TODO(2Pac): Notify the user somehow that this failed?
      return
    }

    const { map } = action.payload

    state.byId.set(map.id, map)
    if (state.favoritedById.has(map.id)) {
      state.favoritedById.set(map.id, map)
    }
  },

  ['@maps/removeMap'](state, action) {
    if (action.error) {
      // TODO(2Pac): Notify the user somehow that this failed?
      return
    }

    const { map } = action.meta

    state.byId.delete(map.id)
    state.favoritedById.delete(map.id)
    state.total = state.total - 1
  },

  ['@maps/clearMaps'](state, action) {
    return DEFAULT_STATE
  },
})
