import { Immutable } from 'immer'
import {
  fromMatchmakingMapPoolJson,
  MatchmakingMapPool,
  MatchmakingType,
} from '../../common/matchmaking'
import { immerKeyedReducer } from '../reducers/keyed-reducer'

export interface MapPoolState {
  byType: Map<MatchmakingType, MatchmakingMapPool>
  isRequestingByType: Map<MatchmakingType, boolean>
  lastErrorByType: Map<MatchmakingType, Error>
}

const DEFAULT_STATE: Immutable<MapPoolState> = {
  byType: new Map(),
  isRequestingByType: new Map(),
  lastErrorByType: new Map(),
}

export default immerKeyedReducer(DEFAULT_STATE, {
  ['@matchmaking/getCurrentMapPoolBegin'](state, action) {
    const {
      payload: { type },
    } = action
    state.isRequestingByType.set(type, true)
    state.lastErrorByType.delete(type)
  },

  ['@matchmaking/getCurrentMapPool'](state, action) {
    if (action.error) {
      const { meta, payload } = action

      state.isRequestingByType.set(meta.type, false)
      state.lastErrorByType.set(meta.type, payload)
      return
    }

    const { meta, payload } = action
    state.isRequestingByType.set(meta.type, false)
    state.lastErrorByType.delete(meta.type)
    state.byType.set(meta.type, fromMatchmakingMapPoolJson(payload.pool))
  },

  ['@network/connect']() {
    return DEFAULT_STATE
  },
})
