import { Immutable } from 'immer'
import { MapInfoJson } from '../../common/maps'
import { immerKeyedReducer } from '../reducers/keyed-reducer'

export interface MapsState {
  /** A map of map ID -> information about the map. */
  byId: Map<string, MapInfoJson>
}

const DEFAULT_STATE: Immutable<MapsState> = {
  byId: new Map(),
}

export default immerKeyedReducer(DEFAULT_STATE, {
  ['@matchmaking/initPreferences'](state, action) {
    if (!action.payload.mapInfos?.length) {
      return
    }

    for (const map of action.payload.mapInfos) {
      state.byId.set(map.id, map)
    }
  },

  ['@matchmaking/updatePreferences'](state, action) {
    if (action.error) {
      return
    }

    for (const map of action.payload.mapInfos) {
      state.byId.set(map.id, map)
    }
  },

  ['@profile/getUserProfile'](state, action) {
    const {
      matchHistory: { maps },
    } = action.payload

    for (const map of maps) {
      state.byId.set(map.id, map)
    }
  },
})
