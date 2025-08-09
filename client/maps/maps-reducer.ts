import { Immutable } from 'immer'
import { MapInfoJson, SbMapId } from '../../common/maps'
import { LOBBY_PREFERENCES_GET, LOBBY_PREFERENCES_UPDATE } from '../actions'
import { immerKeyedReducer } from '../reducers/keyed-reducer'

export interface MapsState {
  /** A map of map ID -> information about the map. */
  byId: Map<SbMapId, MapInfoJson>
  /** A set of favorited map IDs for the current user. */
  favoritedMapIds: Set<SbMapId>
  /** A map of map ID -> the time it was last retrieved. */
  lastRetrieved: Map<SbMapId, number>
}

const DEFAULT_STATE: Immutable<MapsState> = {
  byId: new Map(),
  favoritedMapIds: new Set(),
  lastRetrieved: new Map(),
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
      payload: { maps },
      system: { monotonicTime },
    } = action

    for (const map of maps) {
      state.byId.set(map.id, map)
      state.lastRetrieved.set(map.id, monotonicTime)
    }
  },

  ['@maps/getFavoritedMaps'](state, action) {
    const {
      payload: { favoritedMaps },
      system: { monotonicTime },
    } = action

    for (const map of favoritedMaps) {
      state.byId.set(map.id, map)
      state.favoritedMapIds.add(map.id)
      state.lastRetrieved.set(map.id, monotonicTime)
    }
  },

  ['@maps/getBatchMapInfo'](state, action) {
    if (action.error) {
      return
    }

    const {
      payload: { maps, favoritedMapIds },
      system: { monotonicTime },
    } = action

    for (const map of maps) {
      state.byId.set(map.id, map)
      state.lastRetrieved.set(map.id, monotonicTime)
    }

    for (const mapId of favoritedMapIds) {
      state.favoritedMapIds.add(mapId)
    }
  },

  ['@maps/loadMapInfo'](state, { payload: map, system: { monotonicTime } }) {
    state.byId.set(map.id, map)
    state.lastRetrieved.set(map.id, monotonicTime)
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
      payload: { map },
      system: { monotonicTime },
    } = action

    state.byId.set(map.id, map)
    state.lastRetrieved.set(map.id, monotonicTime)
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

  ['@users/searchMatchHistory'](state, action) {
    const {
      payload: { maps },
      system: { monotonicTime },
    } = action

    for (const map of maps) {
      state.byId.set(map.id, map)
      state.lastRetrieved.set(map.id, monotonicTime)
    }
  },

  [LOBBY_PREFERENCES_GET as any](state: MapsState, action: any) {
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

  [LOBBY_PREFERENCES_UPDATE as any](state: MapsState, action: any) {
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
