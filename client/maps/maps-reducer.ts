import { Draft, Immutable } from 'immer'
import { MapInfoJson, MapVisibility, SbMapId } from '../../common/maps'
import { immerKeyedReducer } from '../reducers/keyed-reducer'

export interface MapsState {
  /** A map of map ID -> information about the map. */
  byId: Map<SbMapId, MapInfoJson>
  /** A set of favorited map IDs for the current user. */
  favoritedMapIds: Set<SbMapId>
  /** A set of the map IDs that are in the current user's own maps. */
  libraryMapIds: Set<SbMapId>
  /** A map of map ID -> the time it was last retrieved. */
  lastRetrieved: Map<SbMapId, number>
}

const DEFAULT_STATE: Immutable<MapsState> = {
  byId: new Map(),
  favoritedMapIds: new Set(),
  libraryMapIds: new Set(),
  lastRetrieved: new Map(),
}

/**
 * Updates which of `maps` are in the current user's own maps, given the subset of them a server
 * response says are. Maps that aren't in that subset are removed from the set, since the response
 * is authoritative for every map it returned.
 */
function updateLibraryMapIds(
  state: Draft<MapsState>,
  maps: ReadonlyArray<{ id: SbMapId }>,
  libraryMapIds: ReadonlyArray<SbMapId>,
) {
  const inLibrary = new Set(libraryMapIds)
  for (const map of maps) {
    if (inLibrary.has(map.id)) {
      state.libraryMapIds.add(map.id)
    } else {
      state.libraryMapIds.delete(map.id)
    }
  }
}

export default immerKeyedReducer(DEFAULT_STATE, {
  ['@games/getGameRecord'](state, { payload: { map }, system: { monotonicTime } }) {
    if (map) {
      state.byId.set(map.id, map)
      state.lastRetrieved.set(map.id, monotonicTime)
    }
  },

  ['@maps/getMaps'](state, action) {
    const {
      payload: { maps, libraryMapIds },
      system: { monotonicTime },
    } = action

    for (const map of maps) {
      state.byId.set(map.id, map)
      state.lastRetrieved.set(map.id, monotonicTime)
    }
    updateLibraryMapIds(state, maps, libraryMapIds)
  },

  ['@maps/getFavoritedMaps'](state, action) {
    const {
      payload: { favoritedMaps, libraryMapIds },
      system: { monotonicTime },
    } = action

    for (const map of favoritedMaps) {
      state.byId.set(map.id, map)
      state.favoritedMapIds.add(map.id)
      state.lastRetrieved.set(map.id, monotonicTime)
    }
    updateLibraryMapIds(state, favoritedMaps, libraryMapIds)
  },

  ['@maps/getBatchMapInfo'](state, action) {
    if (action.error) {
      return
    }

    const {
      payload: { maps, favoritedMapIds, libraryMapIds },
      system: { monotonicTime },
    } = action

    for (const map of maps) {
      state.byId.set(map.id, map)
      state.lastRetrieved.set(map.id, monotonicTime)
    }

    for (const mapId of favoritedMapIds) {
      state.favoritedMapIds.add(mapId)
    }
    updateLibraryMapIds(state, maps, libraryMapIds)
  },

  ['@maps/loadMapInfos'](state, { payload: maps, system: { monotonicTime } }) {
    for (const map of maps) {
      state.byId.set(map.id, map)
      state.lastRetrieved.set(map.id, monotonicTime)
    }
  },

  ['@maps/addToFavorites'](state, action) {
    state.favoritedMapIds.add(action.payload)
  },

  ['@maps/removeFromFavorites'](state, action) {
    state.favoritedMapIds.delete(action.payload)
  },

  ['@maps/removeFromMyMaps'](state, action) {
    state.libraryMapIds.delete(action.payload)
  },

  ['@maps/delistMap'](state, action) {
    const map = state.byId.get(action.payload)
    if (map) {
      map.visibility = MapVisibility.Unlisted
      map.publishedBy = undefined
      map.publishedAt = undefined
    }
  },

  ['@maps/updateMap'](state, action) {
    const {
      payload: { map },
      system: { monotonicTime },
    } = action

    state.byId.set(map.id, map)
    state.lastRetrieved.set(map.id, monotonicTime)
  },

  ['@maps/uploadLocalMap'](state, action) {
    const {
      payload: { map, libraryMapIds },
      system: { monotonicTime },
    } = action

    state.byId.set(map.id, map)
    state.lastRetrieved.set(map.id, monotonicTime)
    updateLibraryMapIds(state, [map], libraryMapIds)
  },

  ['@matchmaking/getCurrentMapPool'](state, action) {
    if (action.error) {
      return
    }

    const {
      payload: { mapInfos },
      system: { monotonicTime },
    } = action

    for (const map of mapInfos) {
      state.byId.set(map.id, map)
      state.lastRetrieved.set(map.id, monotonicTime)
    }
  },

  ['@matchmaking/initPreferences'](state, action) {
    if (!action.payload.mapInfos?.length) {
      return
    }

    const {
      payload: { mapInfos },
      system: { monotonicTime },
    } = action

    for (const map of mapInfos) {
      state.byId.set(map.id, map)
      state.lastRetrieved.set(map.id, monotonicTime)
    }
  },

  ['@matchmaking/updatePreferences'](state, action) {
    if (action.error) {
      return
    }

    const {
      payload: { mapInfos },
      system: { monotonicTime },
    } = action

    for (const map of mapInfos) {
      state.byId.set(map.id, map)
      state.lastRetrieved.set(map.id, monotonicTime)
    }
  },

  ['@users/getUserProfile'](state, action) {
    const {
      payload: {
        matchHistory: { maps },
      },
      system: { monotonicTime },
    } = action

    for (const map of maps) {
      state.byId.set(map.id, map)
      state.lastRetrieved.set(map.id, monotonicTime)
    }
  },

  ['@users/getMatchHistory'](state, action) {
    const {
      payload: { maps },
      system: { monotonicTime },
    } = action

    for (const map of maps) {
      state.byId.set(map.id, map)
      state.lastRetrieved.set(map.id, monotonicTime)
    }
  },

  ['@games/getGames'](state, action) {
    const {
      payload: { maps },
      system: { monotonicTime },
    } = action

    for (const map of maps) {
      state.byId.set(map.id, map)
      state.lastRetrieved.set(map.id, monotonicTime)
    }
  },

  ['@leagues/getLeagueGames'](state, action) {
    const {
      payload: { maps },
      system: { monotonicTime },
    } = action

    for (const map of maps) {
      state.byId.set(map.id, map)
      state.lastRetrieved.set(map.id, monotonicTime)
    }
  },

  ['@maps/getMapGames'](state, action) {
    const {
      payload: { maps },
      system: { monotonicTime },
    } = action

    for (const map of maps) {
      state.byId.set(map.id, map)
      state.lastRetrieved.set(map.id, monotonicTime)
    }
  },

  ['@lobbies/getPreferences'](state, action) {
    if (action.error) {
      return
    }

    const {
      system: { monotonicTime },
    } = action

    for (const map of action.payload.recentMaps) {
      state.byId.set(map.id, map)
      state.lastRetrieved.set(map.id, monotonicTime)
    }
  },

  ['@lobbies/updatePreferences'](state, action) {
    if (action.error) {
      return
    }

    const {
      system: { monotonicTime },
    } = action

    for (const map of action.payload.recentMaps) {
      state.byId.set(map.id, map)
      state.lastRetrieved.set(map.id, monotonicTime)
    }
  },
})
