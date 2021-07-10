import { Immutable } from 'immer'
import { MapInfoJson } from '../../common/maps'
import { immerKeyedReducer } from '../reducers/keyed-reducer'

// TODO(tec27): Combine functionality of this with ./maps-reducer, remove the '2's

export interface Maps2State {
  /** A map of map ID -> information about the map. */
  byId: Map<string, MapInfoJson>
}

const DEFAULT_STATE: Immutable<Maps2State> = {
  byId: new Map(),
}

export default immerKeyedReducer(DEFAULT_STATE, {
  ['@profile/getUserProfile'](
    state,
    {
      payload: {
        matchHistory: { maps },
      },
    },
  ) {
    for (const map of maps) {
      state.byId.set(map.id, map)
    }
  },
})
