import { Immutable } from 'immer'
import { MapInfoJson } from '../../common/maps.js'
import { LOBBY_PREFERENCES_GET, LOBBY_PREFERENCES_UPDATE } from '../actions.js'
import { immerKeyedReducer } from '../reducers/keyed-reducer.js'

export interface MapsState {
  /** A map of map ID -> information about the map. */
  byId: Map<string, MapInfoJson>
  /** A map of map ID -> the time it was last retrieved. */
  lastRetrieved: Map<string, number>
}

const DEFAULT_STATE: Immutable<MapsState> = {
  byId: new Map(),
  lastRetrieved: new Map(),
}

export default immerKeyedReducer(DEFAULT_STATE, {
  ['@auth/logOut']() {
    // TODO(tec27): Remove once MapInfo no longer contains information about it being favorited.
    // That info makes the data user-specific even though it isn't otherwise
    return DEFAULT_STATE
  },

  ['@games/getGameRecord'](state, { payload: { map }, system: { monotonicTime } }) {
    if (map) {
      state.byId.set(map.id, map)
      state.lastRetrieved.set(map.id, monotonicTime)
    }
  },

  ['@maps/getMaps'](state, action) {
    if (action.error) {
      return
    }

    const {
      payload: { maps },
      system: { monotonicTime },
    } = action

    for (const map of maps) {
      state.byId.set(map.id, map)
      state.lastRetrieved.set(map.id, monotonicTime)
    }
  },

  ['@maps/getBatchMapInfo'](state, action) {
    if (action.error) {
      return
    }

    const {
      payload: { maps },
      system: { monotonicTime },
    } = action

    for (const map of maps) {
      state.byId.set(map.id, map)
      state.lastRetrieved.set(map.id, monotonicTime)
    }
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
