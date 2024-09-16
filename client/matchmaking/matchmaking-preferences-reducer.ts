import { Immutable } from 'immer'
import { MatchmakingPreferences, MatchmakingType } from '../../common/matchmaking.js'
import { FetchError } from '../network/fetch-errors.js'
import { immerKeyedReducer } from '../reducers/keyed-reducer.js'

export interface FetchedMatchmakingPreferences {
  preferences?: MatchmakingPreferences | Record<string, never>
  mapPoolOutdated?: boolean
  lastError?: FetchError
}

export interface MatchmakingPreferencesState {
  byType: Map<MatchmakingType, FetchedMatchmakingPreferences>
}

const DEFAULT_STATE: Immutable<MatchmakingPreferencesState> = {
  byType: new Map(),
}

export default immerKeyedReducer(DEFAULT_STATE, {
  ['@matchmaking/initPreferences'](state, action) {
    const { preferences, mapPoolOutdated } = action.payload
    const { type } = action.meta

    if (preferences) {
      state.byType.set(type, { preferences, mapPoolOutdated, lastError: undefined })
    } else {
      state.byType.delete(type)
    }
  },

  ['@matchmaking/updatePreferences'](state, action) {
    const { type } = action.meta

    if (action.error) {
      if (!state.byType.has(type)) {
        state.byType.set(type, { lastError: action.payload })
      } else {
        state.byType.get(type)!.lastError = action.payload
      }
      return
    }

    const { preferences, mapPoolOutdated } = action.payload
    state.byType.set(type, { preferences, mapPoolOutdated })
  },
})
